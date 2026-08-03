"""AI·요약 — 규칙기반 일일 리포트, LLM 종목 브리핑, 관련종목 시사점.

LLM 호출은 비용이 있으므로 모두 TTL 캐시를 거친다. 캐시 키에 들어가는
수치는 반드시 반올림해서 넘길 것 — 원본 실수를 쓰면 시세가 조금만 움직여도
키가 바뀌어 캐시가 사실상 무효화된다.
"""

from datetime import date

from fastapi import APIRouter

from analysis.fundamental import valuation
from analysis.signal import technical_signals
from cache import ttl_cache
from data.ai_briefing import generate_briefing, generate_market_insight
from data.related_stocks import RELATED_STOCKS
from deps import (
    cached_market_rank,
    cached_naver_index,
    change_of,
    load,
    load_fx,
    load_index,
    load_wti,
    market_name,
)

router = APIRouter()


@ttl_cache(60 * 10)
def _build_daily_report():
    tags = []
    parts = []

    for name in ("KOSPI", "KOSDAQ"):
        try:
            d = cached_naver_index(name)
            tags.append({"label": name, "pct": d["changePct"]})
        except Exception:
            pass
    try:
        _, _, pct = change_of(load_index("IXIC")["Close"].dropna())
        tags.append({"label": "NASDAQ", "pct": pct})
    except Exception:
        pass

    kospi = next((t for t in tags if t["label"] == "KOSPI"), None)
    if kospi:
        direction = "강세" if kospi["pct"] >= 0 else "약세"
        parts.append(f"코스피가 {abs(kospi['pct']):.2f}% {direction}를 보이며 마감했습니다.")

    nasdaq = next((t for t in tags if t["label"] == "NASDAQ"), None)
    if nasdaq:
        direction = "상승" if nasdaq["pct"] >= 0 else "하락"
        parts.append(f"전일 나스닥은 {abs(nasdaq['pct']):.2f}% {direction}했습니다.")

    try:
        fx_last, fx_chg, fx_pct = change_of(load_fx()["Close"].dropna())
        tags.append({"label": "원/달러", "pct": fx_pct})
        direction = "상승" if fx_chg >= 0 else "하락"
        parts.append(f"원/달러 환율은 {fx_last:,.1f}원으로 {abs(fx_pct):.2f}% {direction}했습니다.")
    except Exception:
        pass

    try:
        wti_last, wti_chg, wti_pct = change_of(load_wti()["Close"].dropna())
        tags.append({"label": "WTI", "pct": wti_pct})
        direction = "상승" if wti_chg >= 0 else "하락"
        parts.append(f"WTI 원유는 ${wti_last:,.2f}로 {abs(wti_pct):.2f}% {direction}했습니다.")
    except Exception:
        pass

    try:
        gainers = cached_market_rank("up", "KOSPI", 1)
        if gainers:
            g = gainers[0]
            parts.append(f"코스피 급등 상위는 {g['name']}(+{g['changePct']:.2f}%)입니다.")
    except Exception:
        pass

    return {
        "date": date.today().isoformat(),
        "summary": " ".join(parts) if parts else "오늘의 시장 데이터를 불러오지 못했습니다.",
        "tags": tags,
    }


@router.get("/api/daily-report")
def api_daily_report():
    return _build_daily_report()


@ttl_cache(60 * 60 * 3)  # 호출 비용 절감 — 3시간 캐시
def _ai_briefing(market: str, ticker: str, name: str, changePct: float, verdict: str,
                 per: float | None, pbr: float | None):
    context = {
        "등락률(%)": changePct,  # 호출부에서 이미 반올림됨
        "규칙기반신호": verdict,
        "PER": per,
        "PBR": pbr,
    }
    return generate_briefing(name, ticker, context)


@router.get("/api/ai-briefing")
def api_ai_briefing(market: str, ticker: str, name: str = ""):
    df = load(ticker, "3m")
    _, _, pct = change_of(df["Close"].dropna())
    _, _, verdict, _ = technical_signals(df)
    val = valuation(market_name(market), ticker)
    try:
        # 캐시 키가 되므로 반드시 반올림해서 넘긴다.
        result = _ai_briefing(
            market, ticker, name or ticker, round(pct, 2), verdict,
            val.get("PER"), val.get("PBR"),
        )
    except Exception as e:
        return {"available": False, "error": str(e)}
    return {"available": True, **result}


@ttl_cache(60 * 30)  # LLM 호출 비용 절감 — 30분 캐시
def _related_insight(ticker: str, stocks: tuple):
    return generate_market_insight(ticker, [dict(s) for s in stocks])


@router.get("/api/related-insight")
def api_related_insight(ticker: str):
    chain = RELATED_STOCKS.get(ticker)
    if not chain:
        return {"available": False}

    stocks = []
    for tk, name, role in chain:
        try:
            _, _, pct = change_of(load(tk, "5d")["Close"].dropna())
            # 반올림해서 담는다: 이 값이 캐시 키가 되므로 원본 실수를 쓰면
            # 10개 중 하나만 움직여도 캐시가 무효화된다. 표시도 소수 2자리.
            pct = round(pct, 2)
        except Exception:
            pct = None
        stocks.append({"ticker": tk, "name": name, "role": role, "changePct": pct})

    try:
        # dict는 캐시 키로 못 쓰니 튜플로 변환
        insight = _related_insight(ticker, tuple(tuple(s.items()) for s in stocks))
    except Exception:
        insight = None

    return {"available": True, "insight": insight, "stocks": stocks}
