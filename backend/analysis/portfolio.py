"""보유 포트폴리오 진단 — 비중·집중도·테마중복·레버리지·변동성을 수치로 뽑는다.

여기서는 **관찰된 사실만** 계산한다. "무엇을 사라/팔라"는 판단은 하지 않는다.
LLM은 이 수치를 문장으로 옮기는 역할만 맡는다(analysis 결과가 곧 근거).

레버리지 ETF는 기초자산 테마로 접어서 센다. 0193T0(하닉 2배)을 SK하이닉스와
따로 세면 "두 종목에 분산" 처럼 보이지만 실제로는 같은 회사에 2배로 실린 것이다.
"""

from __future__ import annotations

import math

import pandas as pd

from data.leveraged import LEVERAGED

# 티커 -> 테마. 앱이 기본 제공하는 종목 위주이고, 모르는 건 '기타'로 둔다.
# 레버리지 ETF는 여기 적지 않는다 — LEVERAGED로 기초자산을 찾아 그 테마를 쓴다.
_THEME = {
    "005930": "반도체·메모리",
    "000660": "반도체·메모리",
    "SOXX": "반도체",
    "EWY": "한국 시장 전체",
    "KS11": "한국 시장 전체",
    "IXIC": "미국 기술주",
    "QQQ": "미국 기술주",
    "SPY": "미국 시장 전체",
}


def theme_of(ticker: str) -> str:
    """레버리지 상품은 기초자산의 테마로 접어서 본다."""
    if ticker in LEVERAGED:
        return _THEME.get(LEVERAGED[ticker][0], "기타")
    return _THEME.get(ticker, "기타")


def leverage_of(ticker: str) -> float:
    return LEVERAGED[ticker][2] if ticker in LEVERAGED else 1.0


def _weighted_series(positions: list[dict], closes: dict[str, pd.Series]) -> pd.Series | None:
    """비중으로 가중한 포트폴리오 일간수익률.

    개별 변동성을 단순 평균하면 종목 간 상관관계가 빠져 실제와 어긋난다.
    수익률을 먼저 합성한 뒤 표준편차를 내면 상관관계가 자연히 반영된다.

    표본 구간은 **모든 종목이 겹치는 날짜**다. 상장한 지 얼마 안 된 종목이
    하나 끼면 전체 구간이 그만큼 짧아지므로, 길이를 같이 돌려줘 화면에서
    "며칠 기준인지" 밝힐 수 있게 한다.

    미국 종목은 달러 수익률로 들어간다 — 환율 변동은 빠져 있어서 원화 기준
    실제 변동성은 이보다 조금 클 수 있다(환율 일간 변동성은 보통 0.5% 안팎).
    """
    cols = {}
    for p in positions:
        s = closes.get(p["ticker"])
        if s is None or len(s) < 20:
            continue
        cols[p["ticker"]] = s.pct_change()
    if not cols:
        return None
    df = pd.DataFrame(cols).dropna()
    if len(df) < 20:
        return None
    # 시세를 못 구한 종목이 있으면 남은 것끼리 비중을 다시 정규화한다.
    w = {p["ticker"]: p["weight"] for p in positions if p["ticker"] in df.columns}
    total = sum(w.values())
    if total <= 0:
        return None
    return sum(df[t] * (wt / total) for t, wt in w.items())


def _first_buy(trades: list[dict], ticker: str) -> str | None:
    dates = [t["date"] for t in trades if t.get("ticker") == ticker and t.get("side") == "buy"]
    return min(dates) if dates else None


def analyze(
    holdings: list[dict],
    prices: dict[str, float],
    closes: dict[str, pd.Series],
    fx_rate: float | None,
    trades: list[dict] | None = None,
    today: str | None = None,
) -> dict | None:
    """보유종목을 원화 기준으로 정규화해 진단 수치를 만든다.

    holdings: [{ticker, name, market, qty, avg}]
    prices:   {ticker: 현재가} (없으면 평단가로 대체 — 손익 0으로 잡힌다)
    closes:   {ticker: 종가 시계열} 변동성 계산용
    fx_rate:  USD/KRW. 미국 종목이 있는데 없으면 None을 돌려준다.
    """
    if not holdings:
        return None

    has_us = any(h["market"] == "US" for h in holdings)
    if has_us and not fx_rate:
        return None

    positions = []
    total_value = 0.0
    total_cost = 0.0
    for h in holdings:
        rate = fx_rate if h["market"] == "US" else 1.0
        last = prices.get(h["ticker"]) or h["avg"]
        value = last * h["qty"] * rate
        cost = h["avg"] * h["qty"] * rate
        total_value += value
        total_cost += cost
        positions.append({
            "ticker": h["ticker"],
            "name": h["name"],
            "market": h["market"],
            "valueKrw": value,
            "costKrw": cost,
            "plKrw": value - cost,
            "plPct": (value / cost - 1) * 100 if cost else 0.0,
            "leverage": leverage_of(h["ticker"]),
            "theme": theme_of(h["ticker"]),
            "firstBuy": _first_buy(trades or [], h["ticker"]),
        })

    if total_value <= 0:
        return None

    for p in positions:
        p["weight"] = p["valueKrw"] / total_value * 100
    positions.sort(key=lambda p: -p["weight"])

    # 집중도 — HHI(비중 제곱합). 역수는 "실질 몇 종목에 나뉘어 있나"로 읽힌다.
    hhi = sum((p["weight"] / 100) ** 2 for p in positions)
    themes: dict[str, float] = {}
    for p in positions:
        themes[p["theme"]] = themes.get(p["theme"], 0.0) + p["weight"]
    theme_list = sorted(
        ({"theme": k, "weight": v} for k, v in themes.items()),
        key=lambda x: -x["weight"],
    )

    # 레버리지 실효 배수 — 비중 가중. 1.0이면 레버리지 없음.
    eff_lev = sum(p["weight"] / 100 * p["leverage"] for p in positions)
    lev_weight = sum(p["weight"] for p in positions if p["leverage"] > 1)
    us_weight = sum(p["weight"] for p in positions if p["market"] == "US")

    daily = _weighted_series(positions, closes)
    vol = float(daily.std() * 100) if daily is not None else None
    vol_days = len(daily) if daily is not None else None

    holding_days = None
    firsts = [p["firstBuy"] for p in positions if p["firstBuy"]]
    if firsts and today:
        oldest = min(firsts)
        holding_days = (pd.Timestamp(today) - pd.Timestamp(oldest)).days

    return {
        "totals": {
            "valueKrw": total_value,
            "costKrw": total_cost,
            "plKrw": total_value - total_cost,
            "plPct": (total_value / total_cost - 1) * 100 if total_cost else 0.0,
        },
        "positions": positions,
        "concentration": {
            "top1": positions[0]["weight"],
            "top1Name": positions[0]["name"],
            "hhi": hhi,
            # 균등 분산 환산 종목 수. 3종목 균등이면 3.0, 한 종목 몰빵이면 1.0.
            "effectiveN": 1 / hhi if hhi else 0.0,
            "count": len(positions),
        },
        "themes": theme_list,
        "leverage": {"effective": eff_lev, "weight": lev_weight},
        "usWeight": us_weight,
        "dailyVolPct": vol,
        "volDays": vol_days,
        "holdingDays": holding_days,
    }


def observations(a: dict) -> list[str]:
    """수치에서 바로 나오는 관찰. LLM이 죽어도 이건 항상 보여준다.

    권유가 아니라 서술로만 쓴다 — "줄이세요"가 아니라 "이만큼 쏠려 있습니다".
    """
    out = []
    c = a["concentration"]
    if c["count"] == 1:
        out.append(f"한 종목({c['top1Name']})에 전액이 들어가 있어요. 그 종목의 등락이 곧 전체 등락입니다.")
    elif c["top1"] >= 50:
        out.append(
            f"{c['top1Name']} 한 종목이 {c['top1']:.0f}%예요. "
            f"{c['count']}종목을 갖고 있지만 분산 효과는 {c['effectiveN']:.1f}종목 수준입니다."
        )
    else:
        out.append(
            f"{c['count']}종목에 나뉘어 있고, 분산 효과는 {c['effectiveN']:.1f}종목 수준이에요."
        )

    top_theme = a["themes"][0]
    if top_theme["weight"] >= 60 and top_theme["theme"] != "기타":
        out.append(
            f"'{top_theme['theme']}' 한 테마가 {top_theme['weight']:.0f}%입니다. "
            "종목은 여럿이어도 같은 업황을 함께 타게 돼요."
        )

    lev = a["leverage"]
    if lev["weight"] > 0:
        out.append(
            f"레버리지 상품이 {lev['weight']:.0f}%라 실효 배수가 약 {lev['effective']:.1f}배예요. "
            "일별 재조정 상품은 횡보장에서 원금이 깎이는 성질이 있습니다."
        )

    if a["usWeight"] > 0:
        out.append(
            f"미국 자산이 {a['usWeight']:.0f}%라 수익률에 환율이 같이 섞여 들어와요."
        )

    if a["dailyVolPct"] is not None:
        # 대략 68% 구간. 정규분포 가정이라 실제 꼬리는 더 두껍다.
        out.append(
            f"최근 {a['volDays']}거래일 기준 일간 변동성은 {a['dailyVolPct']:.1f}%예요 — "
            f"하루에 ±{a['dailyVolPct']:.1f}% 안에서 움직인 날이 대략 3분의 2였다는 뜻입니다."
        )

    if a["holdingDays"] is not None:
        out.append(f"가장 오래된 보유는 {a['holdingDays']}일째예요.")

    return out


def context_for_llm(a: dict) -> dict:
    """LLM에 넘길 요약. 캐시 키로도 쓰이므로 전부 반올림한다.

    반올림을 안 하면 시세가 조금만 움직여도 키가 바뀌어 캐시가 무효화된다
    (예전에 같은 실수로 호출이 폭증한 적 있음).
    """
    return {
        "총평가액_만원": round(a["totals"]["valueKrw"] / 10000),
        "총손익률": round(a["totals"]["plPct"], 1),
        "종목수": a["concentration"]["count"],
        "최대비중종목": a["concentration"]["top1Name"],
        "최대비중": round(a["concentration"]["top1"]),
        "실질분산종목수": round(a["concentration"]["effectiveN"], 1),
        "테마별비중": {t["theme"]: round(t["weight"]) for t in a["themes"]},
        "레버리지비중": round(a["leverage"]["weight"]),
        "실효배수": round(a["leverage"]["effective"], 1),
        "미국자산비중": round(a["usWeight"]),
        "일간변동성": round(a["dailyVolPct"], 1) if a["dailyVolPct"] is not None else None,
        "보유일수": a["holdingDays"],
        "종목별": [
            {
                "이름": p["name"],
                "비중": round(p["weight"]),
                "손익률": round(p["plPct"], 1),
            }
            for p in a["positions"]
        ],
    }


def sanity(a: dict) -> None:
    """계산이 스스로 어긋나지 않았는지 확인 (테스트에서 호출)."""
    assert abs(sum(p["weight"] for p in a["positions"]) - 100) < 1e-6
    assert abs(sum(t["weight"] for t in a["themes"]) - 100) < 1e-6
    assert 0 < a["concentration"]["hhi"] <= 1 + 1e-9
    assert a["concentration"]["effectiveN"] <= a["concentration"]["count"] + 1e-9
    assert not math.isnan(a["totals"]["plPct"])
