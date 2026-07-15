"""종합 신호 — 규칙 기반(비-AI).

기술적 지표를 정해진 규칙으로 점수화하고, 이동평균·볼린저·최근 고저로
참고 지지/저항 가격대를 산출한다. 예측이 아니라 '요약'이다.

⚠️ 결과는 참고용 정보이며 투자 조언이 아니다.
"""

import pandas as pd

from analysis.technical import bollinger, macd, rsi


DEFAULT_WEIGHTS = {"rsi": 1, "macd": 1, "ma20": 1, "cross": 1, "boll": 1}


def _threshold(max_score: int) -> int:
    """판정 문턱값: 최대점수의 40% (기본 5점 → 2점, 기존과 동일)."""
    return max(1, round(max_score * 0.4))


def technical_signals(df: pd.DataFrame, rsi_low: int = 30, rsi_high: int = 70,
                      weights: dict | None = None):
    """(신호목록, 총점, 판정, 최대점수) 반환.

    weights: 지표별 가중치 {rsi, macd, ma20, cross, boll} ∈ {0(끔),1,2}.
    """
    w = {**DEFAULT_WEIGHTS, **(weights or {})}
    close = df["Close"]
    price = close.iloc[-1]
    r = rsi(close).iloc[-1]
    hist = macd(close)["hist"].iloc[-1]
    ma20 = close.rolling(20).mean().iloc[-1]
    ma60 = close.rolling(60).mean().iloc[-1]
    bb = bollinger(close)
    upper, lower = bb["upper"].iloc[-1], bb["lower"].iloc[-1]
    bpos = (price - lower) / (upper - lower) if upper > lower else 0.5

    signals = []

    def add(key, name, score, detail):
        wt = int(w.get(key, 1))
        if wt == 0:
            return
        signals.append({"name": name + (" ×2" if wt == 2 else ""), "score": score * wt, "detail": detail})

    add("rsi", "RSI(14)",
        1 if r < rsi_low else -1 if r > rsi_high else 0,
        f"{r:.1f} — " + (f"과매도(<{rsi_low}, 반등 기대)" if r < rsi_low
                          else f"과매수(>{rsi_high}, 과열)" if r > rsi_high else "중립 구간"))
    add("macd", "MACD 모멘텀",
        1 if hist > 0 else -1 if hist < 0 else 0,
        ("상승 모멘텀" if hist > 0 else "하락 모멘텀" if hist < 0 else "모멘텀 중립")
        + f" (히스토그램 {hist:,.1f})")
    add("ma20", "단기 추세(20일선)",
        1 if price > ma20 else -1,
        "주가가 20일선 위" if price > ma20 else "주가가 20일선 아래")
    add("cross", "이평 배열",
        1 if ma20 > ma60 else -1,
        "20일선 > 60일선 (정배열)" if ma20 > ma60 else "20일선 < 60일선 (역배열)")
    add("boll", "볼린저 위치",
        1 if bpos < 0.2 else -1 if bpos > 0.8 else 0,
        f"밴드 내 {bpos * 100:.0f}% 지점 — "
        + ("하단 근접" if bpos < 0.2 else "상단 근접" if bpos > 0.8 else "중앙권"))

    total = sum(s["score"] for s in signals)
    max_score = sum(int(v) for v in w.values())
    thr = _threshold(max_score)
    verdict = "매수 우위" if total >= thr else "매도 우위" if total <= -thr else "중립"
    return signals, total, verdict, max_score


def signal_history(df: pd.DataFrame, horizon: int = 5, rsi_low: int = 30,
                   rsi_high: int = 70, weights: dict | None = None):
    """과거 매수/매도 우위 신호의 이후 성과 요약 (미니 백테스트).

    technical_signals와 같은 규칙(가중치·기준값 포함)을 과거 각 날짜에 적용하고,
    신호 발생일로부터 horizon 거래일 뒤 수익률을 집계한다.
    ⚠️ 과거 성과는 미래를 보장하지 않는다 — 참고용.
    """
    w = {**DEFAULT_WEIGHTS, **(weights or {})}
    close = df["Close"]
    if len(close) < 80:
        return {"horizon": horizon, "evaluated": 0, "buy": None, "sell": None, "recent": []}

    r = rsi(close)
    hist = macd(close)["hist"]
    ma20 = close.rolling(20).mean()
    ma60 = close.rolling(60).mean()
    bb = bollinger(close)
    width = (bb["upper"] - bb["lower"]).replace(0, float("nan"))
    bpos = (close - bb["lower"]) / width

    score = (
        w["rsi"] * ((r < rsi_low).astype(int) - (r > rsi_high).astype(int))
        + w["macd"] * ((hist > 0).astype(int) - (hist < 0).astype(int))
        + w["ma20"] * ((close > ma20).astype(int) * 2 - 1)
        + w["cross"] * ((ma20 > ma60).astype(int) * 2 - 1)
        + w["boll"] * ((bpos < 0.2).astype(int) - (bpos > 0.8).astype(int))
    )
    thr = _threshold(sum(int(v) for v in w.values()))

    valid = ma60.notna() & bpos.notna()
    fwd = close.shift(-horizon) / close - 1  # horizon일 뒤 수익률

    def agg(mask, win_positive: bool):
        rets = fwd[mask & fwd.notna()]
        if len(rets) == 0:
            return None
        wins = (rets > 0) if win_positive else (rets < 0)
        return {
            "count": int(len(rets)),
            "avgReturn": float(rets.mean() * 100),
            "winRate": float(wins.mean() * 100),
        }

    buy_mask = valid & (score >= thr)
    sell_mask = valid & (score <= -thr)

    recent = []
    for ts in list(df.index[buy_mask | sell_mask])[-5:]:
        f = fwd.loc[ts]
        recent.append({
            "date": ts.strftime("%Y-%m-%d"),
            "verdict": "매수 우위" if score.loc[ts] >= thr else "매도 우위",
            "fwdReturn": None if pd.isna(f) else float(f * 100),
        })

    return {
        "horizon": horizon,
        "evaluated": int((valid & fwd.notna()).sum()),
        "buy": agg(buy_mask, win_positive=True),
        "sell": agg(sell_mask, win_positive=False),  # 매도신호는 하락해야 적중
        "recent": recent,
    }


def price_levels(df: pd.DataFrame):
    """(현재가, 지지목록, 저항목록) 반환. 목록은 [(라벨, 가격)], 현재가 기준 근접순."""
    close = df["Close"]
    price = close.iloc[-1]
    ma20 = close.rolling(20).mean().iloc[-1]
    ma60 = close.rolling(60).mean().iloc[-1]
    bb = bollinger(close)
    upper, lower = bb["upper"].iloc[-1], bb["lower"].iloc[-1]
    low60 = df["Low"].tail(60).min()
    high60 = df["High"].tail(60).max()

    support = {"20일 이동평균": ma20, "60일 이동평균": ma60,
               "볼린저 하단": lower, "최근 60일 최저": low60}
    resist = {"볼린저 상단": upper, "최근 60일 최고": high60,
              "20일 이동평균": ma20, "60일 이동평균": ma60}

    below = sorted([(k, v) for k, v in support.items() if v < price], key=lambda x: -x[1])
    above = sorted([(k, v) for k, v in resist.items() if v > price], key=lambda x: x[1])
    return price, below, above
