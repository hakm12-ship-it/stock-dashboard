"""시세·기술지표 — 캔들, RSI/MACD/볼린저, 종목검색."""

import pandas as pd
from fastapi import APIRouter

from analysis.technical import bollinger, macd, rsi
from deps import cached_symbols, load, load_with_warmup, market_name, series

router = APIRouter()


@router.get("/api/health")
def health():
    return {"status": "ok"}


@router.get("/api/symbols")
def api_symbols(market: str, q: str = ""):
    df = cached_symbols(market_name(market))
    if not q:
        return df.head(30).to_dict("records")

    key = q.strip().lower()
    ticker = df["ticker"].str.lower()
    name = df["name"].str.lower()
    hit = ticker.str.contains(key, na=False, regex=False) | name.str.contains(key, na=False, regex=False)
    df = df[hit].copy()

    # 찾는 걸 위로 올린다. "nav"를 치면 NAVN·NAVI가 먼저 나와야지,
    # 이름 한가운데 nav가 든 Buenaventura가 먼저 나오면 안 된다.
    t, n = df["ticker"].str.lower(), df["name"].str.lower()
    df["_rank"] = 4
    df.loc[n.str.startswith(key), "_rank"] = 2          # 이름이 그걸로 시작
    df.loc[t.str.startswith(key), "_rank"] = 1          # 티커가 그걸로 시작
    df.loc[t == key, "_rank"] = 0                       # 티커 정확히 일치
    df = df.sort_values(["_rank", "ticker"]).drop(columns="_rank")
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
    # 앞쪽 여유분까지 불러 지표를 계산한 뒤 화면 구간만 잘라 보낸다.
    # 화면 기간만으로 계산하면 MA60은 앞 59칸이 비어 3개월 차트에서 거의 안 보인다.
    df, start = load_with_warmup(ticker, period)
    close = df["Close"]
    m = macd(close)
    bb = bollinger(close)
    cut = lambda s: series(s.iloc[start:])  # noqa: E731
    return {
        "time": [i.strftime("%Y-%m-%d") for i in df.index[start:]],
        "rsi": cut(rsi(close)),
        "macd": cut(m["macd"]), "signal": cut(m["signal"]), "hist": cut(m["hist"]),
        "bb_upper": cut(bb["upper"]), "bb_lower": cut(bb["lower"]),
        "ma20": cut(close.rolling(20).mean()),
        "ma60": cut(close.rolling(60).mean()),
    }
