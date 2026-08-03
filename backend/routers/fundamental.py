"""기본적 분석 — 밸류에이션, 실적추이, 목표주가, 동종업계, 수급, 기업개요."""

from fastapi import APIRouter

from analysis.fundamental import analyst_target, forward_pe, revenue_trend, valuation
from deps import cached_deal_trend, cached_peers, cached_profile, market_name, series

router = APIRouter()


@router.get("/api/valuation")
def api_valuation(market: str, ticker: str):
    return valuation(market_name(market), ticker)


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


@router.get("/api/peers")
def api_peers(market: str, ticker: str):
    if market.upper() == "KR":
        try:
            return cached_peers(ticker)
        except Exception:
            pass
    return []


@router.get("/api/deal-trend")
def api_deal_trend(market: str, ticker: str):
    if market.upper() == "KR":
        try:
            return cached_deal_trend(ticker)
        except Exception:
            pass
    return []


@router.get("/api/profile")
def api_profile(market: str, ticker: str):
    if market.upper() == "KR":
        try:
            return cached_profile(ticker)
        except Exception:
            pass
    return {"name": None, "description": None, "logo": None, "researches": []}
