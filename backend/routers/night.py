"""야간 시세 — KRX 휴장 중에도 24시간 거래되는 Hyperliquid perp 기반 가격·캔들."""

from fastapi import APIRouter

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
