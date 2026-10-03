"""AI·요약 — 규칙기반 일일 리포트, LLM 종목 브리핑, 관련종목 시사점.

LLM은 서버가 정한 종목/구성 키로 재사용하며 전체 생성 예산과 실패 대기를 공유한다.
"""

import json
import hashlib
import math
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, field_validator, model_validator

import analysis.portfolio as pf
from analysis.signal import technical_signals
from cache import ttl_cache
from data.ai_briefing import (
    generate_briefing,
    generate_market_insight,
    generate_portfolio_review,
)
from data.related_stocks import RELATED_STOCKS
from data.freshness import history_freshness
from services import public_ai
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
PORTFOLIO_LIMIT = 50
PORTFOLIO_WORKERS = 8
TRADE_LIMIT = 2000
_portfolio_slots = threading.BoundedSemaphore(2)
_KR_TICKER = re.compile(r"[A-Z0-9]{6}")
_US_TICKER = re.compile(r"[A-Z][A-Z0-9.-]{0,14}")


def _instrument(market: str, ticker: str, *, allow_indices: bool = False) -> tuple[str, str]:
    market, ticker = market.strip().upper(), ticker.strip().upper()
    if allow_indices and market == "KR" and ticker in {"KS11", "KQ11"}:
        return market, ticker
    pattern = _KR_TICKER if market == "KR" else _US_TICKER
    if market not in {"KR", "US"} or not pattern.fullmatch(ticker):
        raise ValueError("유효한 시장과 종목코드가 필요합니다.")
    return market, ticker


def _remember(store: dict, key: str, result) -> None:
    if len(store) >= 128 and key not in store:
        store.pop(next(iter(store)), None)
    store[key] = deepcopy(result)


def _ai_object(value, kind: str) -> dict:
    if not isinstance(value, dict):
        raise ValueError("invalid AI object")
    fields = {"summary": 600, "headline": 120} if kind == "portfolio" else {"summary": 600}
    list_field = "watchPoints" if kind == "portfolio" else "bullets"
    result = {}
    for field, limit in fields.items():
        text = value.get(field)
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= limit:
            raise ValueError("invalid AI text")
        result[field] = text.strip()
    bullets = value.get(list_field, [])
    if not isinstance(bullets, list) or len(bullets) > 5 or any(
        not isinstance(text, str) or not 1 <= len(text.strip()) <= 240 for text in bullets
    ):
        raise ValueError("invalid AI bullets")
    result[list_field] = bullets
    if kind == "briefing":
        if value.get("stance") not in {"강세", "약세", "중립"}:
            raise ValueError("invalid AI stance")
        result["stance"] = value["stance"]
    return result


@ttl_cache(60 * 10)
def _build_daily_report(kst_day: str):
    tags = []
    parts = []

    for name in ("KOSPI", "KOSDAQ"):
        try:
            d = cached_naver_index(name)
            tags.append({"label": name, "pct": d["changePct"], "asOf": d.get("asOf")})
        except Exception:
            pass
    try:
        close = load_index("IXIC")["Close"].dropna()
        _, _, pct = change_of(close)
        tags.append({"label": "NASDAQ", "pct": pct, "asOf": close.index[-1].strftime("%Y-%m-%d")})
    except Exception:
        pass

    kospi = next((t for t in tags if t["label"] == "KOSPI"), None)
    if kospi:
        direction = "강세" if kospi["pct"] >= 0 else "약세"
        try:
            traded = datetime.fromisoformat(str(kospi["asOf"]).replace("Z", "+00:00"))
            if traded.tzinfo is not None:
                traded = traded.astimezone(public_ai.KST)
            reference = f"{traded:%Y-%m-%d} 데이터 기준"
        except (TypeError, ValueError):
            reference = "기준일 미확인 시세로"
        parts.append(f"코스피는 {reference} {abs(kospi['pct']):.2f}% {direction}입니다.")

    nasdaq = next((t for t in tags if t["label"] == "NASDAQ"), None)
    if nasdaq:
        direction = "상승" if nasdaq["pct"] >= 0 else "하락"
        parts.append(f"나스닥은 {nasdaq['asOf']} 데이터 기준 {abs(nasdaq['pct']):.2f}% {direction}했습니다.")

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
        "date": kst_day,
        "summary": " ".join(parts) if parts else "오늘의 시장 데이터를 불러오지 못했습니다.",
        "tags": tags,
    }


@router.get("/api/daily-report")
def api_daily_report():
    return _build_daily_report(datetime.now(public_ai.KST).date().isoformat())


def _ai_briefing(market: str, ticker: str, changePct: float, verdict: str,
                 per: float | None, pbr: float | None):
    context = {
        "등락률(%)": changePct,  # 호출부에서 이미 반올림됨
        "규칙기반신호": verdict,
        "PER": per,
        "PBR": pbr,
    }
    # Neither a caller-supplied display name nor minute-to-minute price changes
    # can create another billable cache identity.
    return public_ai.generate("briefing", f"{market}:{ticker}",
                              lambda: _ai_object(generate_briefing(ticker, ticker, context), "briefing"),
                              ttl=3 * 60 * 60)


# 종목별 마지막 성공 결과. 무료 등급 할당량 초과(429) 등으로 LLM이 실패해도
# 패널이 통째로 사라지지 않도록, 직전 분석을 stale 표시와 함께 내려준다.
_last_briefing: dict[str, dict] = {}
_last_insight: dict[str, str] = {}


@router.get("/api/ai-briefing")
def api_ai_briefing(market: str, ticker: str, name: str = Query(default="", max_length=120)):
    try:
        market, ticker = _instrument(market, ticker, allow_indices=True)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from None
    identity = f"{market}:{ticker}"
    hit = public_ai.cached("briefing", identity)
    if hit is not None:
        return {"available": True, "stale": False, **hit}
    # 종합신호 패널(/api/signal)과 같은 6개월을 쓴다. 두 가지가 걸려 있다:
    # 3개월은 62거래일뿐이라 60일선이 겨우 3점만 유효한 채로 '이평 배열'을
    # 판정하고, 같은 화면의 두 패널이 서로 다른 근거를 쓰게 된다. 게다가
    # 기간이 다르면 캐시도 갈려 같은 종목을 두 번 받는다.
    try:
        public_ai.ensure_available("briefing", identity)
        df = load(ticker, "6m")
        freshness = history_freshness(df, ticker)
        if freshness["stale"]:
            return {"available": False, **freshness, "error": "최근 시세를 확인하지 못해 AI 분석을 보류했습니다."}
        _, _, pct = change_of(df["Close"].dropna())
        if not math.isfinite(pct):
            raise ValueError("invalid market data")
        _, _, verdict, _ = technical_signals(df)
        val = cached_valuation(market_name(market), ticker)
        result = _ai_briefing(
            market, ticker, round(pct, 2), verdict,
            val.get("PER"), val.get("PBR"),
        )
    except Exception as error:
        stale = _last_briefing.get(identity)
        reason = error.reason if isinstance(error, public_ai.AIUnavailable) else "data_unavailable"
        retry_after = error.retry_after if isinstance(error, public_ai.AIUnavailable) else 0
        if stale:
            return {"available": True, "stale": True, "reason": reason, "retryAfter": retry_after, **stale}
        return {"available": False, "error": "AI 분석을 잠시 이용할 수 없습니다.",
                "reason": reason, "retryAfter": retry_after}
    _remember(_last_briefing, identity, result)
    return {"available": True, "stale": False, **result}


def _related_insight(ticker: str, stocks: tuple):
    def create():
        result = generate_market_insight(ticker, [dict(s) for s in stocks])
        if not isinstance(result, str) or not 1 <= len(result.strip()) <= 800:
            raise ValueError("invalid AI insight")
        return result.strip()
    return public_ai.generate("related", ticker, create, ttl=30 * 60)


@router.get("/api/related-insight")
def api_related_insight(ticker: str):
    ticker = ticker.strip().upper()
    chain = RELATED_STOCKS.get(ticker)
    if not chain:
        return {"available": False}

    def pct_of(tk: str):
        try:
            df = load(tk, "1m")
            if history_freshness(df, tk)["stale"]:
                return None
            _, _, pct = change_of(df["Close"].dropna())
            # 반올림해서 담는다: 이 값이 캐시 키가 되므로 원본 실수를 쓰면
            # 10개 중 하나만 움직여도 캐시가 무효화된다. 표시도 소수 2자리.
            return round(pct, 2)
        except Exception:
            return None

    # 10개 종목은 순차 조회하면 콜드 캐시에서 5초 넘게 걸린다. 전부
    # 네트워크 대기라 스레드로 겹쳐 받는다 (순서는 chain 순서 유지).
    with ThreadPoolExecutor(max_workers=min(PORTFOLIO_WORKERS, len(chain))) as pool:
        pcts = list(pool.map(pct_of, [tk for tk, _, _ in chain]))

    stocks = [
        {"ticker": tk, "name": name, "role": role, "changePct": pct}
        for (tk, name, role), pct in zip(chain, pcts)
    ]

    stale = False
    try:
        if any(pct is None for pct in pcts):
            raise ValueError("current related prices unavailable")
        # dict는 캐시 키로 못 쓰니 튜플로 변환
        insight = _related_insight(ticker, tuple(tuple(s.items()) for s in stocks))
        _remember(_last_insight, ticker, insight)
    except Exception:
        # 할당량 초과 등 — 마지막 성공 문구로 버틴다 (등락률 표는 항상 최신).
        insight = _last_insight.get(ticker)
        stale = insight is not None

    return {"available": True, "insight": insight, "stale": stale, "stocks": stocks}


class _Holding(BaseModel):
    ticker: str = Field(min_length=1, max_length=15)
    name: str = Field(min_length=1, max_length=120)
    market: Literal["KR", "US"]
    qty: float = Field(gt=0, le=1_000_000_000, allow_inf_nan=False)
    avg: float = Field(gt=0, le=1_000_000_000, allow_inf_nan=False)

    @model_validator(mode="after")
    def normalize(self):
        self.market, self.ticker = _instrument(self.market, self.ticker)
        return self


class _Trade(BaseModel):
    ticker: str = Field(min_length=1, max_length=15, pattern=r"^[A-Z0-9.-]+$")
    date: str = Field(min_length=10, max_length=10)
    side: Literal["buy", "sell"]

    @field_validator("date")
    @classmethod
    def valid_date(cls, value: str) -> str:
        return date.fromisoformat(value).isoformat()


class _PortfolioBody(BaseModel):
    holdings: list[_Holding] = Field(max_length=PORTFOLIO_LIMIT)
    # 매수 시기는 '일지'에 기록했을 때만 있다. 없으면 보유기간은 생략된다.
    trades: list[_Trade] = Field(default_factory=list, max_length=TRADE_LIMIT)

    @model_validator(mode="after")
    def unique_positions(self):
        keys = [(h.market, h.ticker) for h in self.holdings]
        if len(set(keys)) != len(keys):
            raise ValueError("같은 종목은 하나의 보유 내역으로 합쳐 주세요.")
        return self


def _portfolio_review(identity: str, context_json: str, observations: tuple):
    return public_ai.generate("portfolio", identity,
                              lambda: _ai_object(generate_portfolio_review(json.loads(context_json), list(observations)), "portfolio"),
                              ttl=2 * 60 * 60)


# 마지막 성공 코멘트. 429 등으로 LLM이 실패해도 카드가 비지 않게 한다.
_last_review: dict = {}


@router.post("/api/portfolio-review")
def api_portfolio_review(body: _PortfolioBody, comment: bool = True):
    if not _portfolio_slots.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="포트폴리오 조회가 진행 중입니다. 잠시 후 다시 확인해 주세요.",
                            headers={"Retry-After": "5"})
    try:
        return _analyze_portfolio(body, comment)
    finally:
        _portfolio_slots.release()


def _analyze_portfolio(body: _PortfolioBody, comment: bool):
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
            df = load(ticker, "6m")
            if history_freshness(df, ticker)["stale"]:
                return None
            s = df["Close"].dropna()
            return (ticker, s) if not s.empty else None
        except Exception:  # noqa: BLE001
            return None  # 시세를 못 구한 종목은 평단가로 대체된다

    needs_fx = any(h["market"] == "US" for h in holdings)

    # 종목 수만큼 순차로 받으면 그대로 더해진다. 전부 네트워크 대기라 겹쳐 받고,
    # 환율도 같은 배치에 넣는다 — 뒤에 따로 받으면 그 시간이 그대로 붙는다.
    with ThreadPoolExecutor(max_workers=min(PORTFOLIO_WORKERS, len(holdings) + 1)) as pool:
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
        today=datetime.now(public_ai.KST).date().isoformat(),
    )
    if a is None:
        return {"available": False, "reason": "평가액을 계산할 수 없어요"}

    obs = pf.observations(a)
    out = {"available": True, "analysis": a, "observations": obs, "comment": None, "stale": False}
    if not comment:
        return out
    if len(closes) < len(holdings):
        out["reason"] = "price_data_unavailable"
        return out

    # Keep local display names out of model instructions and the cache key.
    # Quantities/costs identify an actual portfolio edit; changing a name or a
    # live price does not buy another generation within the two-hour TTL.
    identity_data = sorted((h["market"], h["ticker"], h["qty"], h["avg"]) for h in holdings)
    identity_data.append(sorted((t.ticker, t.date, t.side) for t in body.trades))
    key = hashlib.sha256(json.dumps(identity_data, separators=(",", ":")).encode()).hexdigest()
    safe_analysis = deepcopy(a)
    for position in safe_analysis["positions"]:
        position["name"] = position["ticker"]
    safe_analysis["concentration"]["top1Name"] = safe_analysis["positions"][0]["ticker"]
    context = json.dumps(pf.context_for_llm(safe_analysis), ensure_ascii=False, sort_keys=True)
    try:
        out["comment"] = _portfolio_review(key, context, tuple(pf.observations(safe_analysis)))
        _remember(_last_review, key, out["comment"])
    except Exception as error:  # noqa: BLE001
        out["comment"] = _last_review.get(key)
        out["stale"] = out["comment"] is not None
        if isinstance(error, public_ai.AIUnavailable):
            out.update(reason=error.reason, retryAfter=error.retry_after)
    return out
