"""라우터들이 공유하는 데이터 로더·헬퍼.

시세 조회는 모두 TTL 캐시를 거치므로, 여러 라우터가 같은 종목을 조회해도
외부 API 호출은 한 번으로 흡수된다.
"""

import functools
import socket
from datetime import date, datetime
from datetime import time as dt_time
from datetime import timedelta, timezone
from zoneinfo import ZoneInfo

import FinanceDataReader as fdr
import pandas as pd
import requests
from requests.adapters import HTTPAdapter

from analysis.fundamental import valuation
from cache import stale_while_revalidate, ttl_cache
from data.crypto import upbit_top
from data.hyperliquid import fetch_perp_candles, fetch_perp_prices
from data.naver_index import daily_index, realtime_index
from data.naver_stock import (
    naver_deal_trend,
    naver_group_stocks,
    naver_groups,
    naver_market_rank,
    naver_peers,
    naver_profile,
    naver_us_quote,
)
from data.news import fetch_news
from data.symbols import symbols

# FDR은 야후·네이버를 requests로 부르면서 timeout을 주지 않는다. 업스트림이 연결만
# 받고 응답 없이 멈추면 그 요청 스레드와 캐시 키 잠금이 영원히 묶이고, 그런
# 스레드가 쌓이면 /api/health까지 멈춘다. timeout을 안 넘긴 호출에만 기본값을
# 채운다 — 호출부가 정한 값은 줄이지 않는다.
_HTTP_TIMEOUT = (5, 20)  # (연결, 읽기) 초
# KS11/KQ11 이력은 FDR이 pd.read_csv(url)(urllib)로 받아 위 설정이 닿지 않는다.
# 소켓 기본값은 timeout 없이 만든 소켓에만 적용된다.
_SOCKET_TIMEOUT = 20


def _with_default_timeout(send):
    @functools.wraps(send)
    def wrapper(self, request, stream=False, timeout=None, *args, **kwargs):
        if timeout is None:
            timeout = _HTTP_TIMEOUT
        return send(self, request, stream, timeout, *args, **kwargs)

    wrapper.default_timeout = True
    return wrapper


def _install_default_timeouts() -> None:
    """프로세스 전체에 한 번만 건다. 여러 번 불러도 겹쳐 감싸지 않는다."""
    if not getattr(HTTPAdapter.send, "default_timeout", False):
        HTTPAdapter.send = _with_default_timeout(HTTPAdapter.send)
    if socket.getdefaulttimeout() is None:
        socket.setdefaulttimeout(_SOCKET_TIMEOUT)


# main.py가 라우터보다 먼저 이 모듈을 임포트하므로 첫 외부 호출 전에 걸린다.
_install_default_timeouts()

PERIOD_DAYS = {"1m": 30, "3m": 90, "6m": 180, "1y": 365}

INDEX_TICKERS = {"KOSPI": "KS11", "KOSDAQ": "KQ11", "NASDAQ": "IXIC"}

# 캐시된 외부 조회 래퍼 (반복 호출 흡수)
# 종목목록은 하루가 지나도 이전 표로 바로 검색하고 새 표는 뒤에서 받는다.
cached_symbols = stale_while_revalidate(60 * 60 * 24)(symbols)
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
cached_us_quote = ttl_cache(60)(naver_us_quote)
# 재무 지표는 분 단위로 바뀌지 않는데 매 호출마다 네이버를 새로 불렀다.
# /api/valuation과 /api/ai-briefing 양쪽에서 쓰여 호출이 두 배로 났다.
from analysis.fundamental import cached_valuation  # success 1h; empty upstream response 2m


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


def _fill_missing_close(df: pd.DataFrame, ticker: str) -> pd.DataFrame:
    """마지막 세션의 Close가 NaN이면 네이버 종가로 메운다.

    FDR은 미국 종목의 당일 행을 시가·고가·저가까지만 채우고 종가는 한참 뒤에
    넣어준다. 그대로 dropna하면 이미 끝난 세션이 통째로 사라져서, 화요일 오후에
    금요일 종가를 보여주는 일이 생긴다(실측: KORU 5.9% 차이).

    yfinance는 Render에서 야후에 429로 막히므로 쓰지 않는다.
    """
    if "Close" not in df.columns or df.empty:
        return df
    missing = df.index[df["Close"].isna()]
    if len(missing) == 0:
        return df
    try:
        q = cached_us_quote(ticker)
        traded = pd.to_datetime(q["tradedAt"]).date()
    except Exception:
        return df
    df = df.copy()
    for idx in missing:
        if idx.date() == traded:
            df.loc[idx, "Close"] = q["close"]
    return df


def _fetch(ticker: str, start: date) -> pd.DataFrame:
    """FDR 조회 → 미확정 종가 보정 → 분할 보정. load 계열의 공통 경로."""
    if ticker in {"KS11", "KQ11"}:
        df = _kr_index_history(ticker)
        return df.loc[df.index.date >= start].copy()
    df = _fill_missing_close(fdr.DataReader(ticker, start), ticker)
    # 메우지 못한 미확정 행은 제거 (JSON 직렬화·지표 계산 오류 방지)
    return adjust_splits(df.dropna(subset=["Close"]))


@ttl_cache(300)
def _kr_index_history(ticker: str) -> pd.DataFrame:
    """오래된 FDR 지수 일봉을 최신 네이버 OHLC로 보완. 모든 화면이 같은 이력을 사용."""
    parts = []
    try:
        old = fdr.DataReader(ticker, date.today() - timedelta(days=500))
        if not old.empty:
            parts.append(old.dropna(subset=["Close"]))
    except Exception:
        pass
    source = "FinanceDataReader"
    try:
        fresh = daily_index("KOSPI" if ticker == "KS11" else "KOSDAQ")
        parts.append(fresh)
        source = "Naver + FinanceDataReader" if len(parts) > 1 else "Naver"
    except Exception:
        pass
    if not parts:
        raise ValueError("index history unavailable")
    result = pd.concat(parts)
    result = result[~result.index.duplicated(keep="last")].sort_index()
    result.attrs["source"] = source
    return result


@ttl_cache(60)
def load(ticker: str, period: str) -> pd.DataFrame:
    return _fetch(ticker, date.today() - timedelta(days=PERIOD_DAYS.get(period, 90)))


# 60일 이동평균을 화면 첫날부터 그리려면 그 앞 60거래일이 더 있어야 한다.
# 휴일을 감안해 달력일로 넉넉히 잡는다 (60거래일 ≈ 90달력일, 여유 130).
_WARMUP_DAYS = 130


@ttl_cache(60)
def load_with_warmup(ticker: str, period: str) -> tuple[pd.DataFrame, int]:
    """(워밍업 포함 데이터, 화면에 보일 시작 인덱스).

    지표를 화면 기간만큼만 계산하면 MA60은 앞 59칸이 비어 3개월 차트에서
    거의 안 보인다. 앞쪽을 더 불러 계산한 뒤 화면 구간만 잘라 쓴다.
    """
    want = PERIOD_DAYS.get(period, 90)
    df = _fetch(ticker, date.today() - timedelta(days=want + _WARMUP_DAYS))

    cutoff = date.today() - timedelta(days=want)
    visible = [i for i, d in enumerate(df.index) if d.date() >= cutoff]
    return df, visible[0] if visible else 0


@ttl_cache(60)
def load_index(code: str) -> pd.DataFrame:
    return _fetch(code, date.today() - timedelta(days=120))


# 야후 KRW=X 일봉은 런던 자정에 찍힌다. FDR은 이 시각을 UTC 날짜로 잘라서 영국
# 서머타임(3월 말~10월 말) 동안 모든 봉이 하루 앞 날짜로 붙었다 — 월요일 환율이
# 일요일 행이 되고 금요일 행은 사라졌다. 미국 종가와 날짜로 맞추는 환율 기여와
# 포트폴리오 원화 곡선이 다음날 환율을 쓰고 금요일을 빠뜨렸다.
# 그래서 같은 차트 API를 직접 받아 거래소 시간대로 날짜를 매긴다.
_FX_CHART = "https://query2.finance.yahoo.com/v8/finance/chart/KRW=X"
_FX_COLUMNS = {"open": "Open", "high": "High", "low": "Low", "close": "Close",
               "volume": "Volume", "adjclose": "Adj Close"}
_FX_MERGE = {"Open": "first", "High": "max", "Low": "min", "Close": "last",
             "Volume": "sum", "Adj Close": "last"}


def _fx_bars(result: dict) -> pd.DataFrame:
    """야후 차트 응답(result[0]) → 실제 거래일 날짜를 단 일봉. 열은 FDR과 같다.

    마지막 봉은 자정이 아니라 최신 호가 시각에 찍힌다. 토요일 새벽 호가는 금요일
    세션의 끝, 일요일 밤 호가는 월요일(아시아 개장) 세션이라 주말 날짜는 각각
    금요일·월요일로 옮겨 그날 봉에 합친다. 주말 행이 남으면 /api/fx 등락이
    전 거래일 대비가 아니라 '금요일 대비 주말 변동'이 된다.
    """
    stamps = result.get("timestamp") or []
    if not stamps:
        return pd.DataFrame(columns=list(_FX_COLUMNS.values()), index=pd.DatetimeIndex([]))
    tz = result.get("meta", {}).get("exchangeTimezoneName") or "Europe/London"
    days = pd.to_datetime(stamps, unit="s", utc=True).tz_convert(tz).normalize().tz_localize(None)
    days = days + pd.to_timedelta([{5: -1, 6: 1}.get(d, 0) for d in days.weekday], unit="D")
    ind = result["indicators"]
    df = pd.DataFrame({**ind["quote"][0], **ind["adjclose"][0]}, index=days)
    df = df.rename(columns=_FX_COLUMNS)[list(_FX_COLUMNS.values())]
    return df.groupby(level=0).agg(_FX_MERGE)


def _fx_daily(start: date) -> pd.DataFrame:
    """start 이후 USD/KRW 일봉. fdr.DataReader("USD/KRW", start)와 같은 모양."""
    # 서머타임 동안 start일 봉은 전날 23:00 UTC에 찍히므로 하루 앞부터 받아 자른다.
    since = datetime.combine(start - timedelta(days=1), dt_time(), tzinfo=timezone.utc)
    r = requests.get(
        _FX_CHART,
        params={"period1": int(since.timestamp()), "period2": int(datetime.now(timezone.utc).timestamp()),
                "interval": "1d", "includeAdjustedClose": "true"},
        headers={"User-Agent": "Mozilla/5.0 AppleWebKit/537.36"},
        timeout=_HTTP_TIMEOUT,
    )
    r.raise_for_status()
    df = _fx_bars(r.json()["chart"]["result"][0])
    return df.loc[df.index >= pd.Timestamp(start)]


@ttl_cache(60 * 30)
def load_fx() -> pd.DataFrame:
    return _fx_daily(date.today() - timedelta(days=30))


@ttl_cache(60 * 30)
def load_fx_hist(period: str) -> pd.DataFrame:
    return _fx_daily(date.today() - timedelta(days=PERIOD_DAYS.get(period, 90)))


@ttl_cache(60 * 30)
def load_wti() -> pd.DataFrame:
    return fdr.DataReader("CL=F", date.today() - timedelta(days=30))


def load_last_session_close(ticker: str) -> tuple[float, int] | None:
    """(마지막 정규장 종가, 그 시각 ms). 네이버가 마감 시각까지 정확히 준다."""
    q = cached_us_quote(ticker)
    if not q.get("tradedAt"):
        return None
    return q["close"], int(pd.to_datetime(q["tradedAt"]).timestamp() * 1000)


_KST = ZoneInfo("Asia/Seoul")


def load_last_krx_close(ticker: str) -> tuple[float, int] | None:
    """(마지막 KRX 정규장 종가, 그 마감 시각 ms=해당일 15:30 KST). 국내 레버리지 ETF 합성추정용."""
    df = load(ticker, "1m")
    close = df["Close"].dropna()
    if close.empty:
        return None
    last_day = close.index[-1].date()
    close_at = datetime.combine(last_day, dt_time(15, 30), tzinfo=_KST)
    return float(close.iloc[-1]), int(close_at.timestamp() * 1000)


def series(s: pd.Series):
    """NaN을 None으로 바꿔 JSON 직렬화."""
    return [None if pd.isna(v) else float(v) for v in s]


def change_of(close: pd.Series):
    """(마지막값, 전일대비, 등락률%) — 데이터가 1개뿐이면 변화는 0."""
    last = float(close.iloc[-1])
    prev = float(close.iloc[-2]) if len(close) > 1 else last
    return last, last - prev, (last - prev) / prev * 100 if prev else 0
