"""라우터들이 공유하는 데이터 로더·헬퍼.

시세 조회는 모두 TTL 캐시를 거치므로, 여러 라우터가 같은 종목을 조회해도
외부 API 호출은 한 번으로 흡수된다.
"""

from datetime import date, timedelta

import FinanceDataReader as fdr
import pandas as pd

from cache import ttl_cache
from data.crypto import upbit_top
from data.hyperliquid import fetch_perp_candles, fetch_perp_prices
from data.naver_index import realtime_index
from data.naver_stock import (
    naver_deal_trend,
    naver_group_stocks,
    naver_groups,
    naver_market_rank,
    naver_peers,
    naver_profile,
)
from data.news import fetch_news
from data.symbols import symbols

PERIOD_DAYS = {"1m": 30, "3m": 90, "6m": 180, "1y": 365}

INDEX_TICKERS = {"KOSPI": "KS11", "KOSDAQ": "KQ11", "NASDAQ": "IXIC"}

# 캐시된 외부 조회 래퍼 (반복 호출 흡수)
cached_symbols = ttl_cache(60 * 60 * 24)(symbols)
cached_news = ttl_cache(60 * 15)(fetch_news)
cached_naver_index = ttl_cache(30)(realtime_index)  # 실시간이라 짧게
cached_profile = ttl_cache(60 * 60 * 6)(naver_profile)
cached_deal_trend = ttl_cache(60 * 30)(naver_deal_trend)
cached_market_rank = ttl_cache(60 * 5)(naver_market_rank)
cached_peers = ttl_cache(60 * 30)(naver_peers)
cached_crypto_top = ttl_cache(60)(upbit_top)
cached_groups = ttl_cache(60 * 5)(naver_groups)
cached_group_stocks = ttl_cache(60 * 5)(naver_group_stocks)
cached_perp_prices = ttl_cache(30)(fetch_perp_prices)
cached_perp_candles = ttl_cache(60)(fetch_perp_candles)


def market_name(code: str) -> str:
    return "한국" if code.upper() == "KR" else "미국"


def _nice_ratio(r: float) -> float:
    """분할 비율을 깔끔한 정수(20:1 등)로 스냅. 애매하면 원값 사용."""
    if r >= 1:
        rr = round(r)
        return float(rr) if rr >= 2 and abs(r - rr) <= 0.15 * rr else r
    inv = 1.0 / r
    rr = round(inv)
    return 1.0 / rr if rr >= 2 and abs(inv - rr) <= 0.15 * rr else r


def adjust_splits(df: pd.DataFrame) -> pd.DataFrame:
    """액면분할/병합 자동 보정 — 데이터 소스가 과거를 미반영한 경우 대비.

    전일종가÷당일시가가 2.5배 이상(또는 0.4 이하)이면 분할로 보고
    그 이전 구간의 가격을 현재 스케일로 환산한다. 소스가 나중에
    스스로 조정하면 비율이 1에 수렴해 자동으로 비활성화된다.
    """
    n = len(df)
    if n < 2 or "Open" not in df.columns:
        return df
    closes = df["Close"].to_numpy()
    opens = df["Open"].to_numpy()
    divs = [1.0] * n
    div = 1.0
    for i in range(n - 1, 0, -1):
        o, c = opens[i], closes[i - 1]
        if o and c and not (pd.isna(o) or pd.isna(c)) and o > 0:
            r = c / o
            if r >= 2.5 or 0 < r <= 0.4:
                div *= _nice_ratio(r)
        divs[i - 1] = div
    if div == 1.0:
        return df
    df = df.copy()
    s = pd.Series(divs, index=df.index)
    for col in ("Open", "High", "Low", "Close"):
        if col in df.columns:
            df[col] = df[col] / s
    if "Volume" in df.columns:
        df["Volume"] = df["Volume"] * s
    return df


@ttl_cache(60 * 10)
def _hourly_closes(ticker: str) -> dict:
    """{장 날짜: 종가} — 미국 일봉의 종가가 늦게 채워지는 구간을 메우는 데 쓴다."""
    import yfinance as yf

    h = yf.Ticker(ticker).history(period="7d", interval="1h")["Close"].dropna()
    if h.empty:
        return {}
    h.index = h.index.tz_convert("America/New_York")
    return {d: float(v.iloc[-1]) for d, v in h.groupby(h.index.date)}


def _fill_missing_close(df: pd.DataFrame, ticker: str) -> pd.DataFrame:
    """마지막 세션의 Close가 NaN이면 시간봉 종가로 메운다.

    FDR은 미국 종목의 당일 행을 시가·고가·저가까지만 채우고 종가는 한참 뒤에
    넣어준다. 그대로 dropna하면 이미 끝난 세션이 통째로 사라져서, 화요일 오후에
    금요일 종가를 보여주는 일이 생긴다(실측: KORU 5.9% 차이).
    """
    if "Close" not in df.columns or df.empty:
        return df
    missing = df.index[df["Close"].isna()]
    if len(missing) == 0:
        return df
    try:
        closes = _hourly_closes(ticker)
    except Exception:
        return df
    if not closes:
        return df
    df = df.copy()
    for idx in missing:
        px = closes.get(idx.date())
        if px is not None:
            df.loc[idx, "Close"] = px
    return df


@ttl_cache(60)
def load(ticker: str, period: str) -> pd.DataFrame:
    start = date.today() - timedelta(days=PERIOD_DAYS.get(period, 90))
    df = fdr.DataReader(ticker, start)
    df = _fill_missing_close(df, ticker)
    # 메우지 못한 미확정 행은 제거 (JSON 직렬화·지표 계산 오류 방지)
    return adjust_splits(df.dropna(subset=["Close"]))


@ttl_cache(60)
def load_index(code: str) -> pd.DataFrame:
    return fdr.DataReader(code, date.today() - timedelta(days=120))


@ttl_cache(60 * 30)
def load_fx() -> pd.DataFrame:
    return fdr.DataReader("USD/KRW", date.today() - timedelta(days=30))


@ttl_cache(60 * 30)
def load_fx_hist(period: str) -> pd.DataFrame:
    start = date.today() - timedelta(days=PERIOD_DAYS.get(period, 90))
    return fdr.DataReader("USD/KRW", start)


@ttl_cache(60 * 30)
def load_wti() -> pd.DataFrame:
    return fdr.DataReader("CL=F", date.today() - timedelta(days=30))


@ttl_cache(60 * 5)
def load_last_session_close(ticker: str) -> tuple[float, int] | None:
    """(마지막 정규장 종가, 그 시각 ms). 일봉은 하루 늦게 집계되므로 시간봉을 쓴다."""
    import yfinance as yf

    h = yf.Ticker(ticker).history(period="5d", interval="1h")["Close"].dropna()
    if h.empty:
        return None
    return float(h.iloc[-1]), int(h.index[-1].timestamp() * 1000)


def series(s: pd.Series):
    """NaN을 None으로 바꿔 JSON 직렬화."""
    return [None if pd.isna(v) else float(v) for v in s]


def change_of(close: pd.Series):
    """(마지막값, 전일대비, 등락률%) — 데이터가 1개뿐이면 변화는 0."""
    last = float(close.iloc[-1])
    prev = float(close.iloc[-2]) if len(close) > 1 else last
    return last, last - prev, (last - prev) / prev * 100 if prev else 0
