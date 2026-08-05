"""기본적 분석 — 밸류에이션, 실적추이, 목표주가, 동종업계, 수급, 기업개요."""

from fastapi import APIRouter

from analysis.fundamental import analyst_target, forward_pe, revenue_trend
from analysis.leverage import decay_analysis
from data.leveraged import LEVERAGED
from deps import (
    cached_deal_trend,
    cached_peers,
    cached_profile,
    cached_valuation,
    load,
    market_name,
    series,
)

router = APIRouter()

_EMPTY_PROFILE = {"name": None, "description": None, "logo": None, "researches": []}


def _kr_only(market: str, fetch, ticker: str, fallback):
    """네이버 기반 국내 전용 조회 — 해외 종목이거나 조회가 실패하면 기본값.

    이 계열은 없으면 그냥 안 보여주는 부가 정보라, 실패를 500으로 올리지 않고
    빈 값으로 떨어뜨려 화면이 깨지지 않게 한다.
    """
    if market.upper() == "KR":
        try:
            return fetch(ticker)
        except Exception:
            pass
    return fallback


@router.get("/api/valuation")
def api_valuation(market: str, ticker: str):
    return cached_valuation(market_name(market), ticker)


@router.get("/api/trend")
def api_trend(market: str, ticker: str):
    tr = revenue_trend(market_name(market), ticker)
    if tr is None or tr.empty:
        return None
    return {
        "years": [int(y) for y in tr.index],
        **{col: series(tr[col]) for col in tr.columns},
    }


@router.get("/api/forward-pe")
def api_forward_pe(market: str, ticker: str):
    return forward_pe(market_name(market), ticker)


@router.get("/api/target")
def api_target(market: str, ticker: str):
    return analyst_target(market_name(market), ticker)


@router.get("/api/leverage-decay")
def api_leverage_decay(ticker: str, period: str = "6m"):
    entry = LEVERAGED.get(ticker)
    if not entry:
        return {"available": False}
    und_ticker, und_name, lev = entry
    try:
        etf = load(ticker, period)["Close"].dropna()
        und = load(und_ticker, period)["Close"].dropna()
    except Exception:
        return {"available": False}

    result = decay_analysis(etf, und, lev)
    if result is None:
        return {"available": False}
    return {
        "available": True,
        "underlyingTicker": und_ticker,
        "underlyingName": und_name,
        **result,
    }


@router.get("/api/peers")
def api_peers(market: str, ticker: str):
    return _kr_only(market, cached_peers, ticker, [])


@router.get("/api/deal-trend")
def api_deal_trend(market: str, ticker: str):
    return _kr_only(market, cached_deal_trend, ticker, [])


@router.get("/api/profile")
def api_profile(market: str, ticker: str):
    return _kr_only(market, cached_profile, ticker, dict(_EMPTY_PROFILE))
