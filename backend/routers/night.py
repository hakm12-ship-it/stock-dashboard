"""야간 시세 — KRX 휴장 중에도 24시간 거래되는 Hyperliquid perp 기반 가격·캔들."""

from datetime import datetime, timezone

import pandas as pd
from fastapi import APIRouter

from analysis.night_gap import night_gap_backtest
from cache import ttl_cache
from data.hyperliquid import TICKER_TO_PERP
from data.synthetic import SYNTHETIC
from deps import (
    cached_perp_candles,
    cached_perp_prices,
    change_of,
    load,
    load_fx,
    load_last_krx_close,
    load_last_session_close,
)

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

    # "1m"으로 맞춘다 — PERIOD_DAYS에 없는 키를 넘기면 조용히 90일로 떨어지고,
    # load_last_krx_close("1m")와 캐시가 갈려 같은 데이터를 두 번 받는다.
    krx_close = float(load(ticker, "1m")["Close"].dropna().iloc[-1])
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


@router.get("/api/synth-price")
def api_synth_price(ticker: str):
    """정규장 밖에서 레버리지 ETF의 추정가 (기초자산 perp × 배수)."""
    entry = SYNTHETIC.get(ticker)
    if not entry:
        return {"available": False}
    perp, leverage, und_name, market = entry

    try:
        base = load_last_session_close(ticker) if market == "US" else load_last_krx_close(ticker)
        # 60m = Hyperliquid의 1h. 지원 키가 아닌 값을 넘기면 조용히 5분봉으로
        # 떨어져 조회 구간이 10시간밖에 안 된다(정규장 마감이 범위 밖으로 나감).
        # 96시간(4일)로 여유를 둔다 — 금요일 마감~월요일 개장 공백이 최대 ~65시간.
        candles = cached_perp_candles(perp, "60m", 96)
    except Exception as e:
        return {"available": False, "error": str(e)}
    if not base or not candles:
        return {"available": False, "error": "기준 시세 없음"}
    last_close, close_ms = base

    # 정규장 마감 시각에 가장 가까운 봉을 기준으로 삼는다. 같은 perp 시장
    # 안에서 비교해야 현물과의 괴리(basis)가 상쇄된다.
    ref = min(candles, key=lambda c: abs(c["t"] + 3_600_000 - close_ms))
    ref_px, cur_px = ref["c"], candles[-1]["c"]
    if not ref_px:
        return {"available": False}

    und_pct = (cur_px / ref_px - 1) * 100
    est_pct = leverage * und_pct
    return {
        "available": True,
        "estimate": last_close * (1 + est_pct / 100),
        "lastClose": last_close,
        "lastCloseAt": close_ms // 1000,
        "changePct": est_pct,
        "underlyingName": und_name,
        "underlyingPct": und_pct,
        "leverage": leverage,
        "asOf": candles[-1]["t"] // 1000,
    }
