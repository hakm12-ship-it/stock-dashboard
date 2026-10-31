"""야간 perp 흐름이 다음날 KRX 시가를 예측하는지 검증.

**시각 정렬이 이 분석의 핵심이다.** Hyperliquid 일봉은 UTC 00:00 = KST 09:00에
시작해 다음날 KST 08:59에 닫는다. 그래서 일봉은 **닫히는 날**(시작일 + 1일)로
키를 잡는다 — 그 종가가 그날 KRX 개장(09:00) **1분 전** 가격이라, 그 값으로
당일 시가를 예측하는 건 미래를 참조하지 않는다(lookahead 없음).
시작일로 키를 잡으면 금요일 키가 토요일 09:00 가격이 되어, perp가 주말·휴일에
움직인 몫이 월요일(휴장 다음날) 표본에서 빠지고 그다음 거래일로 밀린다.
캔들 간격이나 인덱싱을 바꾼다면 이 정렬이 유지되는지 반드시 다시 확인할 것.
"""

from datetime import datetime, timedelta, timezone

import pandas as pd

_DAY_MS = 24 * 60 * 60 * 1000

# 갭 구간 (하한, 상한, 표시명)
BUCKETS = [
    (-1e9, -2.0, "-2% 미만"),
    (-2.0, 0.0, "-2 ~ 0%"),
    (0.0, 2.0, "0 ~ +2%"),
    (2.0, 1e9, "+2% 초과"),
]


def closes_by_krx_open(candles: list[dict]) -> pd.Series:
    """Hyperliquid 1d 캔들 -> {KST 날짜: 그날 09:00 개장 직전 perp 종가}.

    시작 UTC 날짜 + 1일로 키를 잡는다. 금요일 시작 캔들은 토요일 키가 되고,
    월요일 개장 직전 가격은 일요일 시작 캔들의 종가다(perp는 주말에도 거래).
    """
    out = {}
    for c in candles:
        # UTC 00:00에 시작하지 않는 봉은 개장 뒤에 닫힐 수 있다(lookahead) — 버린다.
        if c["t"] % _DAY_MS:
            continue
        start = datetime.fromtimestamp(c["t"] / 1000, tz=timezone.utc).date()
        out[start + timedelta(days=1)] = c["c"]
    return pd.Series(out, dtype=float)


def night_gap_backtest(perp_close: pd.Series, krx: pd.DataFrame) -> dict | None:
    """perp_close: KST 날짜 -> 그날 개장 직전 perp 종가(closes_by_krx_open), krx: Open/Close 일봉.

    각 거래일 cur와 직전 거래일 prev에 대해 'prev 개장 → cur 개장 사이 perp 변화'와
    'cur 시가의 prev 종가 대비 변화'를 짝짓는다. 둘 사이에 주말·휴일이 끼면 perp
    구간도 그만큼 길어져, 휴장 중 움직임이 전부 cur 표본에 들어간다.
    """
    days = sorted(set(krx.index))
    rows = []
    for i in range(1, len(days)):
        prev, cur = days[i - 1], days[i]
        if prev not in perp_close.index or cur not in perp_close.index:
            continue
        base = perp_close.loc[prev]
        if not base:
            continue
        gap = (perp_close.loc[cur] / base - 1) * 100
        prev_close = krx.loc[prev, "Close"]
        if not prev_close or pd.isna(prev_close) or pd.isna(krx.loc[cur, "Open"]):
            continue
        open_chg = (krx.loc[cur, "Open"] / prev_close - 1) * 100
        rows.append((gap, open_chg))

    if len(rows) < 20:
        return None

    df = pd.DataFrame(rows, columns=["gap", "open"])
    corr = float(df["gap"].corr(df["open"]))
    same_dir = float(((df["gap"] > 0) == (df["open"] > 0)).mean() * 100)

    buckets = []
    for lo, hi, label in BUCKETS:
        s = df[(df["gap"] >= lo) & (df["gap"] < hi)]
        if len(s) < 5:
            continue
        buckets.append({
            "label": label,
            "count": int(len(s)),
            "avgOpenChange": float(s["open"].mean()),
            "upRatio": float((s["open"] > 0).mean() * 100),
        })

    return {
        "samples": int(len(df)),
        "correlation": corr,
        "directionMatch": same_dir,
        "buckets": buckets,
    }
