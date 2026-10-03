"""규칙기반 종합신호 — 신호 판정, 백테스트, 예상 변동범위."""

from fastapi import APIRouter

from analysis.forecast import expected_range
from analysis.signal import price_levels, signal_history, technical_signals
from deps import load, cached_naver_index
from data.freshness import history_freshness

router = APIRouter()


def signal_freshness(df, ticker: str):
    quote = None
    if ticker in {"KS11", "KQ11"}:
        try:
            quote = cached_naver_index("KOSPI" if ticker == "KS11" else "KOSDAQ")
        except Exception:
            pass
    return history_freshness(df, ticker, quote=quote)


def _weights(w_rsi: int, w_macd: int, w_ma20: int, w_cross: int, w_boll: int) -> dict:
    clamp = lambda v: max(0, min(2, int(v)))  # noqa: E731
    return {"rsi": clamp(w_rsi), "macd": clamp(w_macd), "ma20": clamp(w_ma20),
            "cross": clamp(w_cross), "boll": clamp(w_boll)}


@router.get("/api/signal")
def api_signal(ticker: str, period: str = "6m", rsi_low: int = 30, rsi_high: int = 70,
               w_rsi: int = 1, w_macd: int = 1, w_ma20: int = 1, w_cross: int = 1, w_boll: int = 1):
    df = load(ticker, period)
    freshness = signal_freshness(df, ticker)
    if freshness["stale"] or len(df) < 60:
        return {"available": False, **freshness, "verdict": "분석 보류", "signals": [],
                "total": 0, "maxScore": 5, "price": float(df["Close"].iloc[-1]) if not df.empty else None,
                "support": [], "resistance": [],
                "reason": freshness.get("reason", "분석에 필요한 60거래일 데이터가 부족합니다.")}
    weights = _weights(w_rsi, w_macd, w_ma20, w_cross, w_boll)
    signals, total, verdict, max_score = technical_signals(
        df, rsi_low=rsi_low, rsi_high=rsi_high, weights=weights)
    price, below, above = price_levels(df)
    return {
        "available": True, **freshness,
        "signals": signals, "total": total, "verdict": verdict, "maxScore": max_score,
        "price": float(price),
        "support": [{"label": k, "value": float(v)} for k, v in below],
        "resistance": [{"label": k, "value": float(v)} for k, v in above],
    }


@router.get("/api/signal-history")
def api_signal_history(ticker: str, horizon: int = 5, rsi_low: int = 30, rsi_high: int = 70,
                       w_rsi: int = 1, w_macd: int = 1, w_ma20: int = 1, w_cross: int = 1,
                       w_boll: int = 1):
    return signal_history(
        load(ticker, "1y"), horizon=horizon, rsi_low=rsi_low, rsi_high=rsi_high,
        weights=_weights(w_rsi, w_macd, w_ma20, w_cross, w_boll))


@router.get("/api/forecast")
def api_forecast(ticker: str, period: str = "3m", horizon: int = 7):
    df = load(ticker, period)
    freshness = signal_freshness(df, ticker)
    if freshness["stale"] or len(df) < 20:
        return {"available": False, **freshness, "last": None, "sigma": None, "band": []}
    last, sigma, rng = expected_range(df, horizon=horizon)
    return {
        "available": True, **freshness,
        "last": float(last), "sigma": float(sigma),
        "band": [
            {"time": i.strftime("%Y-%m-%d"),
             **{c: float(rng.loc[i, c]) for c in rng.columns}}
            for i in rng.index
        ],
    }
