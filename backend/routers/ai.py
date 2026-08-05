"""AI·요약 — 규칙기반 일일 리포트, LLM 종목 브리핑, 관련종목 시사점.

LLM 호출은 비용이 있으므로 모두 TTL 캐시를 거친다. 캐시 키에 들어가는
수치는 반드시 반올림해서 넘길 것 — 원본 실수를 쓰면 시세가 조금만 움직여도
키가 바뀌어 캐시가 사실상 무효화된다.
"""

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date

from fastapi import APIRouter
from pydantic import BaseModel

import analysis.portfolio as pf
from analysis.signal import technical_signals
from cache import ttl_cache
from data.ai_briefing import (
    generate_briefing,
    generate_market_insight,
    generate_portfolio_review,
)
from data.related_stocks import RELATED_STOCKS
from deps import (
    cached_market_rank,
    cached_naver_index,
    cached_valuation,
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


# 종목별 마지막 성공 결과. 무료 등급 할당량 초과(429) 등으로 LLM이 실패해도
# 패널이 통째로 사라지지 않도록, 직전 분석을 stale 표시와 함께 내려준다.
_last_briefing: dict[str, dict] = {}
_last_insight: dict[str, str] = {}


@router.get("/api/ai-briefing")
def api_ai_briefing(market: str, ticker: str, name: str = ""):
    # 종합신호 패널(/api/signal)과 같은 6개월을 쓴다. 두 가지가 걸려 있다:
    # 3개월은 62거래일뿐이라 60일선이 겨우 3점만 유효한 채로 '이평 배열'을
    # 판정하고, 같은 화면의 두 패널이 서로 다른 근거를 쓰게 된다. 게다가
    # 기간이 다르면 캐시도 갈려 같은 종목을 두 번 받는다.
    df = load(ticker, "6m")
    _, _, pct = change_of(df["Close"].dropna())
    _, _, verdict, _ = technical_signals(df)
    val = cached_valuation(market_name(market), ticker)
    try:
        # 캐시 키가 되므로 반드시 반올림해서 넘긴다.
        result = _ai_briefing(
            market, ticker, name or ticker, round(pct, 2), verdict,
            val.get("PER"), val.get("PBR"),
        )
    except Exception as e:
        stale = _last_briefing.get(ticker)
        if stale:
            return {"available": True, "stale": True, **stale}
        return {"available": False, "error": str(e)}
    _last_briefing[ticker] = result
    return {"available": True, "stale": False, **result}


@ttl_cache(60 * 30)  # LLM 호출 비용 절감 — 30분 캐시
def _related_insight(ticker: str, stocks: tuple):
    return generate_market_insight(ticker, [dict(s) for s in stocks])


@router.get("/api/related-insight")
def api_related_insight(ticker: str):
    chain = RELATED_STOCKS.get(ticker)
    if not chain:
        return {"available": False}

    def pct_of(tk: str):
        try:
            _, _, pct = change_of(load(tk, "1m")["Close"].dropna())
            # 반올림해서 담는다: 이 값이 캐시 키가 되므로 원본 실수를 쓰면
            # 10개 중 하나만 움직여도 캐시가 무효화된다. 표시도 소수 2자리.
            return round(pct, 2)
        except Exception:
            return None

    # 10개 종목은 순차 조회하면 콜드 캐시에서 5초 넘게 걸린다. 전부
    # 네트워크 대기라 스레드로 겹쳐 받는다 (순서는 chain 순서 유지).
    with ThreadPoolExecutor(max_workers=len(chain)) as pool:
        pcts = list(pool.map(pct_of, [tk for tk, _, _ in chain]))

    stocks = [
        {"ticker": tk, "name": name, "role": role, "changePct": pct}
        for (tk, name, role), pct in zip(chain, pcts)
    ]

    stale = False
    try:
        # dict는 캐시 키로 못 쓰니 튜플로 변환
        insight = _related_insight(ticker, tuple(tuple(s.items()) for s in stocks))
        _last_insight[ticker] = insight
    except Exception:
        # 할당량 초과 등 — 마지막 성공 문구로 버틴다 (등락률 표는 항상 최신).
        insight = _last_insight.get(ticker)
        stale = insight is not None

    return {"available": True, "insight": insight, "stale": stale, "stocks": stocks}


class _Holding(BaseModel):
    ticker: str
    name: str
    market: str
    qty: float
    avg: float


class _Trade(BaseModel):
    ticker: str
    date: str
    side: str


class _PortfolioBody(BaseModel):
    holdings: list[_Holding]
    # 매수 시기는 '일지'에 기록했을 때만 있다. 없으면 보유기간은 생략된다.
    trades: list[_Trade] = []


@ttl_cache(60 * 60 * 2)  # LLM 호출 비용 절감 — 구성이 그대로면 2시간 재사용
def _portfolio_review(context_json: str, observations: tuple):
    return generate_portfolio_review(json.loads(context_json), list(observations))


# 마지막 성공 코멘트. 429 등으로 LLM이 실패해도 카드가 비지 않게 한다.
_last_review: dict = {}


@router.post("/api/portfolio-review")
def api_portfolio_review(body: _PortfolioBody, comment: bool = True):
    """보유 포트폴리오 진단.

    보유종목은 브라우저(localStorage)에만 있어서 서버가 가진 게 없다. 그래서
    조회가 아니라 POST로 받는다.

    comment=false면 LLM을 건너뛰고 수치만 즉시 돌려준다. 프런트는 이걸 먼저
    받아 카드를 그리고, 코멘트는 뒤이어 채운다 — LLM을 기다리는 2초 동안
    카드가 통째로 비어 있던 게 느리게 느껴지는 주된 이유였다.

    수치와 관찰은 규칙기반이라 항상 나오고, LLM 코멘트만 실패할 수 있다.
    그때는 comment=None으로 내려보내고 프런트가 관찰만 보여준다.
    """
    holdings = [h.model_dump() for h in body.holdings]
    if not holdings:
        return {"available": False, "reason": "보유종목 없음"}

    def _load_close(ticker: str):
        try:
            s = load(ticker, "6m")["Close"].dropna()
            return (ticker, s) if not s.empty else None
        except Exception:  # noqa: BLE001
            return None  # 시세를 못 구한 종목은 평단가로 대체된다

    needs_fx = any(h["market"] == "US" for h in holdings)

    # 종목 수만큼 순차로 받으면 그대로 더해진다. 전부 네트워크 대기라 겹쳐 받고,
    # 환율도 같은 배치에 넣는다 — 뒤에 따로 받으면 그 시간이 그대로 붙는다.
    with ThreadPoolExecutor(max_workers=len(holdings) + 1) as pool:
        fx_future = pool.submit(lambda: change_of(load_fx()["Close"].dropna())[0]) if needs_fx else None
        fetched = list(pool.map(_load_close, [h["ticker"] for h in holdings]))
        fx_rate = None
        if fx_future:
            try:
                fx_rate = fx_future.result()
            except Exception:  # noqa: BLE001
                return {"available": False, "reason": "환율 조회 실패"}

    closes = {tk: s for r in fetched if r for tk, s in [r]}
    prices = {tk: float(s.iloc[-1]) for tk, s in closes.items()}

    a = pf.analyze(
        holdings, prices, closes, fx_rate,
        trades=[t.model_dump() for t in body.trades],
        today=date.today().isoformat(),
    )
    if a is None:
        return {"available": False, "reason": "평가액을 계산할 수 없어요"}

    obs = pf.observations(a)
    out = {"available": True, "analysis": a, "observations": obs, "comment": None, "stale": False}
    if not comment:
        return out

    key = json.dumps(pf.context_for_llm(a), ensure_ascii=False, sort_keys=True)
    try:
        out["comment"] = _portfolio_review(key, tuple(obs))
        _last_review[key] = out["comment"]
    except Exception:  # noqa: BLE001
        out["comment"] = _last_review.get(key)
        out["stale"] = out["comment"] is not None
    return out
