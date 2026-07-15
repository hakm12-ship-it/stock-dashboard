"""스톡 인사이트 API — FastAPI.

기존 분석 모듈(analysis/·data/)을 그대로 재사용해 JSON API로 노출한다.
React 프런트엔드가 이 API를 호출한다.

실행:  uvicorn main:app --reload --port 8000
"""

from datetime import date, timedelta
from pathlib import Path

import FinanceDataReader as fdr
import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from analysis.forecast import expected_range
from analysis.fundamental import analyst_target, forward_pe, revenue_trend, valuation
from analysis.signal import price_levels, signal_history, technical_signals
from analysis.technical import bollinger, macd, rsi
from cache import ttl_cache
from data.crypto import upbit_top
from data.naver_index import realtime_index
from data.naver_stock import naver_deal_trend, naver_market_rank, naver_peers, naver_profile
from data.news import fetch_news
from data.symbols import symbols

# 캐시된 조회 래퍼 (반복 호출 흡수)
_symbols = ttl_cache(60 * 60 * 24)(symbols)
_news = ttl_cache(60 * 15)(fetch_news)
_naver_index = ttl_cache(30)(realtime_index)  # 실시간이라 짧게
_profile = ttl_cache(60 * 60 * 6)(naver_profile)
_deal_trend = ttl_cache(60 * 30)(naver_deal_trend)
_market_rank = ttl_cache(60 * 5)(naver_market_rank)
_peers = ttl_cache(60 * 30)(naver_peers)
_crypto_top = ttl_cache(60)(upbit_top)

app = FastAPI(title="스톡 인사이트 API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 개발용. 배포 시 프런트 도메인으로 좁힐 것.
    allow_methods=["*"],
    allow_headers=["*"],
)

PERIOD_DAYS = {"1m": 30, "3m": 90, "6m": 180, "1y": 365}


def _market(code: str) -> str:
    return "한국" if code.upper() == "KR" else "미국"


def _nice_ratio(r: float) -> float:
    """분할 비율을 깔끔한 정수(20:1 등)로 스냅. 애매하면 원값 사용."""
    if r >= 1:
        rr = round(r)
        return float(rr) if rr >= 2 and abs(r - rr) <= 0.15 * rr else r
    inv = 1.0 / r
    rr = round(inv)
    return 1.0 / rr if rr >= 2 and abs(inv - rr) <= 0.15 * rr else r


def _adjust_splits(df: pd.DataFrame) -> pd.DataFrame:
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


@ttl_cache(60)
def _load(ticker: str, period: str) -> pd.DataFrame:
    start = date.today() - timedelta(days=PERIOD_DAYS.get(period, 90))
    df = fdr.DataReader(ticker, start)
    # 장중 미확정 행 등 Close가 NaN인 행 제거 (JSON 직렬화·지표 계산 오류 방지)
    return _adjust_splits(df.dropna(subset=["Close"]))


@ttl_cache(60)
def _load_index(code: str) -> pd.DataFrame:
    return fdr.DataReader(code, date.today() - timedelta(days=120))


def _series(s: pd.Series):
    """NaN을 None으로 바꿔 JSON 직렬화."""
    return [None if pd.isna(v) else float(v) for v in s]


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/symbols")
def api_symbols(market: str, q: str = ""):
    df = _symbols(_market(market))
    if q:
        mask = df["name"].str.contains(q, case=False, na=False) | \
            df["ticker"].str.contains(q, case=False, na=False)
        df = df[mask]
    return df.head(30).to_dict("records")


@app.get("/api/prices")
def api_prices(ticker: str, period: str = "3m"):
    df = _load(ticker, period)
    out = []
    for idx, r in df.iterrows():
        if any(pd.isna(r[c]) for c in ("Open", "High", "Low", "Close")):
            continue  # OHLC 누락 행 스킵
        vol = r.get("Volume")
        out.append({
            "time": idx.strftime("%Y-%m-%d"),
            "open": float(r["Open"]), "high": float(r["High"]),
            "low": float(r["Low"]), "close": float(r["Close"]),
            "volume": 0.0 if pd.isna(vol) else float(vol),
        })
    return out


@app.get("/api/indicators")
def api_indicators(ticker: str, period: str = "3m"):
    df = _load(ticker, period)
    close = df["Close"]
    m = macd(close)
    bb = bollinger(close)
    return {
        "time": [i.strftime("%Y-%m-%d") for i in df.index],
        "rsi": _series(rsi(close)),
        "macd": _series(m["macd"]), "signal": _series(m["signal"]), "hist": _series(m["hist"]),
        "bb_upper": _series(bb["upper"]), "bb_lower": _series(bb["lower"]),
        "ma20": _series(close.rolling(20).mean()),
        "ma60": _series(close.rolling(60).mean()),
    }


@app.get("/api/valuation")
def api_valuation(market: str, ticker: str):
    return valuation(_market(market), ticker)


@app.get("/api/trend")
def api_trend(market: str, ticker: str):
    tr = revenue_trend(_market(market), ticker)
    if tr is None or tr.empty:
        return None
    return {
        "years": [int(y) for y in tr.index],
        **{col: _series(tr[col]) for col in tr.columns},
    }


def _weights(w_rsi: int, w_macd: int, w_ma20: int, w_cross: int, w_boll: int) -> dict:
    clamp = lambda v: max(0, min(2, int(v)))  # noqa: E731
    return {"rsi": clamp(w_rsi), "macd": clamp(w_macd), "ma20": clamp(w_ma20),
            "cross": clamp(w_cross), "boll": clamp(w_boll)}


@app.get("/api/signal")
def api_signal(ticker: str, period: str = "6m", rsi_low: int = 30, rsi_high: int = 70,
               w_rsi: int = 1, w_macd: int = 1, w_ma20: int = 1, w_cross: int = 1, w_boll: int = 1):
    df = _load(ticker, period)
    weights = _weights(w_rsi, w_macd, w_ma20, w_cross, w_boll)
    signals, total, verdict, max_score = technical_signals(
        df, rsi_low=rsi_low, rsi_high=rsi_high, weights=weights)
    price, below, above = price_levels(df)
    return {
        "signals": signals, "total": total, "verdict": verdict, "maxScore": max_score,
        "price": float(price),
        "support": [{"label": k, "value": float(v)} for k, v in below],
        "resistance": [{"label": k, "value": float(v)} for k, v in above],
    }


@app.get("/api/signal-history")
def api_signal_history(ticker: str, horizon: int = 5, rsi_low: int = 30, rsi_high: int = 70,
                       w_rsi: int = 1, w_macd: int = 1, w_ma20: int = 1, w_cross: int = 1,
                       w_boll: int = 1):
    return signal_history(
        _load(ticker, "1y"), horizon=horizon, rsi_low=rsi_low, rsi_high=rsi_high,
        weights=_weights(w_rsi, w_macd, w_ma20, w_cross, w_boll))


@app.get("/api/forecast")
def api_forecast(ticker: str, period: str = "3m", horizon: int = 7):
    df = _load(ticker, period)
    last, sigma, rng = expected_range(df, horizon=horizon)
    return {
        "last": float(last), "sigma": float(sigma),
        "band": [
            {"time": i.strftime("%Y-%m-%d"),
             **{c: float(rng.loc[i, c]) for c in rng.columns}}
            for i in rng.index
        ],
    }


@app.get("/api/news")
def api_news(market: str, name: str):
    return _news(_market(market), name)


@app.get("/api/forward-pe")
def api_forward_pe(market: str, ticker: str):
    return forward_pe(_market(market), ticker)


@app.get("/api/target")
def api_target(market: str, ticker: str):
    return analyst_target(_market(market), ticker)


@app.get("/api/market-top")
def api_market_top(direction: str = "up", market: str = "KOSPI"):
    d = "down" if direction == "down" else "up"
    m = market.upper() if market.upper() in ("KOSPI", "KOSDAQ", "NASDAQ", "NYSE", "CRYPTO") else "KOSPI"
    try:
        if m == "CRYPTO":
            return _crypto_top(d)
        return _market_rank(d, m)
    except Exception:
        return []


@app.get("/api/peers")
def api_peers(market: str, ticker: str):
    if market.upper() == "KR":
        try:
            return _peers(ticker)
        except Exception:
            pass
    return []


@app.get("/api/deal-trend")
def api_deal_trend(market: str, ticker: str):
    if market.upper() == "KR":
        try:
            return _deal_trend(ticker)
        except Exception:
            pass
    return []


@app.get("/api/profile")
def api_profile(market: str, ticker: str):
    if market.upper() == "KR":
        try:
            return _profile(ticker)
        except Exception:
            pass
    return {"name": None, "description": None, "logo": None, "researches": []}


INDEX_TICKERS = {"KOSPI": "KS11", "KOSDAQ": "KQ11", "NASDAQ": "IXIC"}


@app.get("/api/index")
def api_index(name: str):
    code = INDEX_TICKERS.get(name.upper())
    if not code:
        return None
    df = _load_index(code)
    close = df["Close"].dropna()
    last, prev = float(close.iloc[-1]), float(close.iloc[-2])
    change = last - prev
    pct = (change / prev * 100) if prev else 0
    # 국내 지수는 네이버 실시간으로 현재값 덮어쓰기 (FDR 지수 갱신 지연 보완)
    if name.upper() in ("KOSPI", "KOSDAQ"):
        try:
            rt = _naver_index(name.upper())
            last, change, pct = rt["last"], rt["change"], rt["changePct"]
        except Exception:
            pass
    return {
        "name": name.upper(), "last": last, "change": change, "changePct": pct,
        "series": [{"time": i.strftime("%Y-%m-%d"), "close": float(c)} for i, c in close.items()],
    }


@ttl_cache(60 * 30)
def _load_fx():
    return fdr.DataReader("USD/KRW", date.today() - timedelta(days=30))


@ttl_cache(60 * 30)
def _load_fx_hist(period: str):
    start = date.today() - timedelta(days=PERIOD_DAYS.get(period, 90))
    return fdr.DataReader("USD/KRW", start)


@app.get("/api/fx-history")
def api_fx_history(period: str = "3m"):
    close = _load_fx_hist(period)["Close"].dropna()
    return [{"time": i.strftime("%Y-%m-%d"), "rate": float(v)} for i, v in close.items()]


@app.get("/api/fx")
def api_fx():
    close = _load_fx()["Close"].dropna()
    last = float(close.iloc[-1])
    prev = float(close.iloc[-2]) if len(close) > 1 else last
    return {
        "usdkrw": last,
        "change": last - prev,
        "changePct": (last - prev) / prev * 100 if prev else 0,
    }


# ---- 프로덕션: 빌드된 프론트엔드 정적 서빙 (단일 서비스 배포용) ----
# 반드시 모든 /api 라우트 뒤에 마운트해야 API가 우선한다.
_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(_DIST), html=True), name="frontend")
