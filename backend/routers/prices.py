"""시세·기술지표 — 캔들, RSI/MACD/볼린저, 종목검색."""

import pandas as pd
from fastapi import APIRouter

from analysis.technical import bollinger, macd, rsi
from deps import cached_symbols, load, market_name, series

router = APIRouter()


@router.get("/api/health")
def health():
    return {"status": "ok"}


@router.get("/api/symbols")
def api_symbols(market: str, q: str = ""):
    df = cached_symbols(market_name(market))
    if q:
        mask = df["name"].str.contains(q, case=False, na=False) | \
            df["ticker"].str.contains(q, case=False, na=False)
        df = df[mask]
    return df.head(30).to_dict("records")


@router.get("/api/prices")
def api_prices(ticker: str, period: str = "3m"):
    df = load(ticker, period)
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


@router.get("/api/indicators")
def api_indicators(ticker: str, period: str = "3m"):
    df = load(ticker, period)
    close = df["Close"]
    m = macd(close)
    bb = bollinger(close)
    return {
        "time": [i.strftime("%Y-%m-%d") for i in df.index],
        "rsi": series(rsi(close)),
        "macd": series(m["macd"]), "signal": series(m["signal"]), "hist": series(m["hist"]),
        "bb_upper": series(bb["upper"]), "bb_lower": series(bb["lower"]),
        "ma20": series(close.rolling(20).mean()),
        "ma60": series(close.rolling(60).mean()),
    }
