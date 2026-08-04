"""야간 시세 — KRX 휴장 중에도 24시간 거래되는 Hyperliquid perp 기반 가격·캔들."""

from datetime import datetime, timezone

import pandas as pd
from fastapi import APIRouter

from analysis.night_gap import night_gap_backtest
from cache import ttl_cache
from data.hyperliquid import TICKER_TO_PERP
from deps import cached_perp_candles, cached_perp_prices, change_of, load, load_fx

router = APIRouter()


@router.get("/api/night-price")
def api_night_price(ticker: str):
    perp = TICKER_TO_PERP.get(ticker)
    if not perp:
        return {"available": False}
    usd = cached_perp_prices().get(perp)
    if usd is None:
        return {"available": False}
    fx_last, _, _ = change_of(load_fx()["Close"].dropna())
    krw = usd * fx_last

    krx_close = float(load(ticker, "5d")["Close"].dropna().iloc[-1])
    gap_pct = (krw - krx_close) / krx_close * 100 if krx_close else 0

    return {
        "available": True,
        "usd": usd,
        "krw": krw,
        "krxClose": krx_close,
        "gapPct": gap_pct,
    }


@router.get("/api/night-candles")
def api_night_candles(ticker: str, interval: str = "5m"):
    perp = TICKER_TO_PERP.get(ticker)
    if not perp:
        return {"available": False, "candles": []}
    fx_last, _, _ = change_of(load_fx()["Close"].dropna())
    return {
        "available": True,
        "candles": [
            {
                "time": c["t"] // 1000,
                "open": c["o"] * fx_last, "high": c["h"] * fx_last,
                "low": c["l"] * fx_last, "close": c["c"] * fx_last,
                "volume": c["v"],
            }
            for c in cached_perp_candles(perp, interval)
        ],
    }


@ttl_cache(60 * 60 * 6)  # 일봉 기반이라 자주 바뀌지 않는다
def _night_gap(ticker: str, perp: str):
    candles = cached_perp_candles(perp, "1d", 200)
    # 캔들 시작(t)의 UTC 날짜로 인덱싱하면, 그 종가는 다음 KST 영업일 08:59
    # = KRX 개장 1분 전 가격이 된다. analysis/night_gap.py 주석 참고.
    closes = pd.Series(
        {datetime.fromtimestamp(c["t"] / 1000, tz=timezone.utc).date(): c["c"] for c in candles}
    )
    krx = load(ticker, "1y").copy()
    krx.index = [i.date() for i in krx.index]
    return night_gap_backtest(closes, krx)


@router.get("/api/night-gap-history")
def api_night_gap_history(ticker: str):
    perp = TICKER_TO_PERP.get(ticker)
    if not perp:
        return {"available": False}
    try:
        result = _night_gap(ticker, perp)
    except Exception:
        return {"available": False}
    if result is None:
        return {"available": False}
    return {"available": True, **result}
