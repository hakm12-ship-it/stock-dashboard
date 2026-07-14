"""기술적 분석 지표 계산.

가격 시계열(pandas Series/DataFrame)을 받아 지표를 반환한다.
순수 계산만 담당 — 화면 표시는 ui 쪽에서.
"""

import pandas as pd


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    """RSI (상대강도지수). Wilder 평활법(ewm alpha=1/period) 사용.

    0~100 범위. 통상 70 이상 과매수, 30 이하 과매도로 본다.
    """
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period).mean()
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def macd(
    close: pd.Series,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> pd.DataFrame:
    """MACD. (macd, signal, hist) 3개 시리즈를 DataFrame으로 반환.

    macd   = EMA(fast) - EMA(slow)
    signal = EMA(macd, signal)
    hist   = macd - signal   (0선 상향 돌파 = 강세 신호로 해석)
    """
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    hist = macd_line - signal_line
    return pd.DataFrame({"macd": macd_line, "signal": signal_line, "hist": hist})


def bollinger(close: pd.Series, window: int = 20, num_std: float = 2.0) -> pd.DataFrame:
    """볼린저 밴드. (mid, upper, lower) 를 DataFrame으로 반환.

    mid   = 이동평균(window)
    upper = mid + num_std × 표준편차
    lower = mid - num_std × 표준편차
    밴드 폭은 변동성을, 밴드 접촉은 과열/과매도 국면을 시사한다.
    """
    mid = close.rolling(window).mean()
    std = close.rolling(window).std()
    return pd.DataFrame({"mid": mid, "upper": mid + num_std * std, "lower": mid - num_std * std})
