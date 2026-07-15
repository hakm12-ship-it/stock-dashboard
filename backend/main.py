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
from analysis.fundamental import forward_pe, revenue_trend, valuation
from analysis.signal import price_levels, technical_signals
from analysis.technical import bollinger, macd, rsi
from cache import ttl_cache
from data.naver_index import realtime_index
from data.news import fetch_news
from data.symbols import symbols

# 캐시된 조회 래퍼 (반복 호출 흡수)
_symbols = ttl_cache(60 * 60 * 24)(symbols)
_news = ttl_cache(60 * 15)(fetch_news)
_naver_index = ttl_cache(30)(realtime_index)  # 실시간이라 짧게

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


@ttl_cache(60)
def _load(ticker: str, period: str) -> pd.DataFrame:
    start = date.today() - timedelta(days=PERIOD_DAYS.get(period, 90))
    return fdr.DataReader(ticker, start)


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
    return [
        {"time": idx.strftime("%Y-%m-%d"),
         "open": float(r["Open"]), "high": float(r["High"]),
         "low": float(r["Low"]), "close": float(r["Close"]),
         "volume": float(r["Volume"])}
        for idx, r in df.iterrows()
    ]


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


@app.get("/api/signal")
def api_signal(ticker: str, period: str = "6m"):
    df = _load(ticker, period)
    signals, total, verdict = technical_signals(df)
    price, below, above = price_levels(df)
    return {
        "signals": signals, "total": total, "verdict": verdict, "price": float(price),
        "support": [{"label": k, "value": float(v)} for k, v in below],
        "resistance": [{"label": k, "value": float(v)} for k, v in above],
    }


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


INDEX_TICKERS = {"KOSPI": "KS11", "NASDAQ": "IXIC"}


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
    # 코스피는 네이버 실시간으로 현재값 덮어쓰기 (FDR 지수 갱신 지연 보완)
    if name.upper() == "KOSPI":
        try:
            rt = _naver_index("KOSPI")
            last, change, pct = rt["last"], rt["change"], rt["changePct"]
        except Exception:
            pass
    return {
        "name": name.upper(), "last": last, "change": change, "changePct": pct,
        "series": [{"time": i.strftime("%Y-%m-%d"), "close": float(c)} for i, c in close.items()],
    }


# ---- 프로덕션: 빌드된 프론트엔드 정적 서빙 (단일 서비스 배포용) ----
# 반드시 모든 /api 라우트 뒤에 마운트해야 API가 우선한다.
_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(_DIST), html=True), name="frontend")
