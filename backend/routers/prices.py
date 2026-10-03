"""시세·기술지표 — 캔들, RSI/MACD/볼린저, 종목검색."""

import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

import pandas as pd
from fastapi import APIRouter, Query, HTTPException

from analysis.technical import bollinger, macd, rsi
from cache import ttl_cache
from data.naver_index import realtime_quote
from data.naver_stock import naver_us_quote
from deps import cached_symbols, load, load_with_warmup, market_name, series, PERIOD_DAYS
from routers.signal import api_signal

router = APIRouter()

# 목표가 알림용 현재가. 네이버 폴링 시세라 지연이 있고 공식 실시간 시세는 아니다.
_cached_kr_quote = ttl_cache(30)(realtime_quote)
_cached_us_quote = ttl_cache(30)(naver_us_quote)
_KR_CODE = re.compile(r"^[A-Z0-9]{6}$")
_US_CODE = re.compile(r"^[A-Z][A-Z0-9.-]{0,14}$")
QUOTE_BATCH_LIMIT = 20
_watchlist_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="watchlist")


@router.get("/api/quotes")
def api_quotes(market: str, tickers: str = ""):
    """여러 종목의 현재가. 실패한 종목은 개별 error로 표시하고 전체는 200을 돌려준다."""
    is_kr = market.upper() == "KR"
    pattern = _KR_CODE if is_kr else _US_CODE
    codes = []
    for raw in tickers.split(","):
        code = raw.strip().upper()
        if code and code not in codes:
            codes.append(code)
    out = []
    for code in codes[:QUOTE_BATCH_LIMIT]:
        if not pattern.match(code):
            out.append({"ticker": code, "error": "invalid ticker"})
            continue
        try:
            if is_kr:
                q = _cached_kr_quote(code)
                out.append({"ticker": code, "price": q["last"], "changePct": q["changePct"], "marketOpen": bool(q["marketOpen"]),
                            "asOf": q.get("asOf")})
            else:
                q = _cached_us_quote(code)
                out.append({"ticker": code, "price": q["close"], "changePct": q["changePct"], "marketOpen": bool(q["marketOpen"]),
                            "asOf": q.get("tradedAt")})
        except Exception as exc:  # noqa: BLE001 - 한 종목 실패가 배치 전체를 막으면 안 된다
            out.append({"ticker": code, "error": str(exc)[:200]})
    return out
# 검색 결과 상한. 30이면 "KODEX"처럼 결과가 많은 검색에서 대부분이 잘려 나갔다.
SYMBOL_LIMIT = 100


@router.get("/api/health")
def health():
    return {"status": "ok"}


@router.get("/api/symbols")
def api_symbols(market: str, q: str = ""):
    df = cached_symbols(market_name(market))
    if not q:
        return df.head(SYMBOL_LIMIT).to_dict("records")

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
    return df.head(SYMBOL_LIMIT).to_dict("records")


@router.get("/api/prices")
def api_prices(ticker: str, period: str = "3m"):
    df = load(ticker, period)
    return _candles(df)


def _candles(df):
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


def _watchlist_item(args):
    ticker, period, cfg = args
    try:
        # 가격 흐름과 신호가 동일한 6개월 원본을 재사용한다.
        df = load(ticker, "6m")
        cutoff = datetime.now(ZoneInfo("Asia/Seoul")).date() - timedelta(days=PERIOD_DAYS[period])
        visible = df.loc[df.index.date >= cutoff]
        signal = api_signal(ticker, **cfg)
        return {"ticker": ticker, "candles": _candles(visible), "signal": signal,
                **{key: signal[key] for key in ("asOf", "source", "stale", "reason") if key in signal}}
    except Exception:
        return {"ticker": ticker, "error": "시세를 불러오지 못했습니다."}


@router.get("/api/watchlist")
def api_watchlist(tickers: str = Query(max_length=400), period: Literal["1m", "3m", "6m"] = "3m",
                  rsi_low: int = 30, rsi_high: int = 70, w_rsi: int = 1, w_macd: int = 1,
                  w_ma20: int = 1, w_cross: int = 1, w_boll: int = 1):
    codes = list(dict.fromkeys(code.strip().upper() for code in tickers.split(",") if code.strip()))
    if len(codes) > QUOTE_BATCH_LIMIT or any(not re.fullmatch(r"[A-Z0-9][A-Z0-9.\-]{0,14}", c) for c in codes):
        raise HTTPException(status_code=422, detail="한 번에 최대 20개 종목을 조회할 수 있습니다.")
    cfg = dict(rsi_low=rsi_low, rsi_high=rsi_high, w_rsi=w_rsi, w_macd=w_macd, w_ma20=w_ma20,
               w_cross=w_cross, w_boll=w_boll)
    return list(_watchlist_pool.map(_watchlist_item, [(code, period, cfg) for code in codes]))


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
