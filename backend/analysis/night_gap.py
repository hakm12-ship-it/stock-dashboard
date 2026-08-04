"""야간 perp 흐름이 다음날 KRX 시가를 예측하는지 검증.

**시각 정렬이 이 분석의 핵심이다.** Hyperliquid 일봉은 UTC 00:00 = KST 09:00에
시작해 KST 08:59에 닫는다. 즉 일봉 종가는 KRX 개장(09:00) **1분 전** 가격이라,
그 값으로 당일 시가를 예측하는 건 미래를 참조하지 않는다(lookahead 없음).
캔들 간격이나 인덱싱을 바꾼다면 이 정렬이 유지되는지 반드시 다시 확인할 것.
"""

import pandas as pd

# 갭 구간 (하한, 상한, 표시명)
BUCKETS = [
    (-1e9, -2.0, "-2% 미만"),
    (-2.0, 0.0, "-2 ~ 0%"),
    (0.0, 2.0, "0 ~ +2%"),
    (2.0, 1e9, "+2% 초과"),
]


def night_gap_backtest(perp_close: pd.Series, krx: pd.DataFrame) -> dict | None:
    """perp_close: date -> 종가(KST 08:59), krx: Open/Close 일봉.

    각 거래일에 대해 '직전 야간 perp 변화'와 '그날 시가의 전일종가 대비 변화'를 짝짓는다.
    """
    days = sorted(set(krx.index))
    rows = []
    for i in range(2, len(days)):
        prev, cur = days[i - 1], days[i]
        pprev = days[i - 2]
        if prev not in perp_close.index or pprev not in perp_close.index:
            continue
        base = perp_close.loc[pprev]
        if not base:
            continue
        gap = (perp_close.loc[prev] / base - 1) * 100
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
