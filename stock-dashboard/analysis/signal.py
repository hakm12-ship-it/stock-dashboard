"""종합 신호 — 규칙 기반(비-AI).

기술적 지표를 정해진 규칙으로 점수화하고, 이동평균·볼린저·최근 고저로
참고 지지/저항 가격대를 산출한다. 예측이 아니라 '요약'이다.

⚠️ 결과는 참고용 정보이며 투자 조언이 아니다.
"""

import pandas as pd

from analysis.technical import bollinger, macd, rsi


def technical_signals(df: pd.DataFrame):
    """(신호목록, 총점, 판정) 반환. 각 신호 score ∈ {-1,0,+1} (+가 매수 우호)."""
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

    def add(name, score, detail):
        signals.append({"name": name, "score": score, "detail": detail})

    add("RSI(14)",
        1 if r < 30 else -1 if r > 70 else 0,
        f"{r:.1f} — " + ("과매도(반등 기대)" if r < 30 else "과매수(과열)" if r > 70 else "중립 구간"))
    add("MACD 모멘텀",
        1 if hist > 0 else -1 if hist < 0 else 0,
        ("상승 모멘텀" if hist > 0 else "하락 모멘텀" if hist < 0 else "모멘텀 중립")
        + f" (히스토그램 {hist:,.1f})")
    add("단기 추세(20일선)",
        1 if price > ma20 else -1,
        "주가가 20일선 위" if price > ma20 else "주가가 20일선 아래")
    add("이평 배열",
        1 if ma20 > ma60 else -1,
        "20일선 > 60일선 (정배열)" if ma20 > ma60 else "20일선 < 60일선 (역배열)")
    add("볼린저 위치",
        1 if bpos < 0.2 else -1 if bpos > 0.8 else 0,
        f"밴드 내 {bpos * 100:.0f}% 지점 — "
        + ("하단 근접" if bpos < 0.2 else "상단 근접" if bpos > 0.8 else "중앙권"))

    total = sum(s["score"] for s in signals)
    verdict = "매수 우위" if total >= 2 else "매도 우위" if total <= -2 else "중립"
    return signals, total, verdict


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
