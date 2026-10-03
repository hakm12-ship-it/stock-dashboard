"""Verify manual AI requests with isolated storage and mocked API responses.

Run: python scripts/verify_manual_ai.py [http://127.0.0.1:8000]
Use a current local frontend build. Every API call is intercepted; external
hosts and service workers are blocked. No model or Telegram request is sent.
"""

import json
import re
import sys
from collections import Counter
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect, sync_playwright


BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
assert urlsplit(BASE).hostname in {"127.0.0.1", "localhost"}, "Use a local build only"
OUT = Path(__file__).resolve().parents[1] / ".qa" / "manual-ai"
OUT.mkdir(parents=True, exist_ok=True)
TODAY = date.today().isoformat()
CANDLES = [{"time": (date.today() - timedelta(days=10 - index)).isoformat(), "open": 70000,
            "high": 71000, "low": 69000, "close": 70000 + index, "volume": 1000} for index in range(10)]
PORTFOLIO = {
    "available": True,
    "analysis": {
        "totals": {"valueKrw": 140000, "costKrw": 120000, "plKrw": 20000, "plPct": 16.67},
        "positions": [{"ticker": "005930", "name": "삼성전자", "market": "KR", "weight": 100,
                       "valueKrw": 140000, "plKrw": 20000, "plPct": 16.67, "leverage": 1, "theme": "반도체"}],
        "concentration": {"top1": 100, "top1Name": "삼성전자", "effectiveN": 1, "count": 1},
        "themes": [{"theme": "반도체", "weight": 100}], "leverage": {"effective": 1, "weight": 0},
        "usWeight": 0, "dailyVolPct": None, "volDays": None, "holdingDays": None,
    },
    "observations": ["검증 수치: 삼성전자 비중 100%"], "comment": None,
}


class Harness:
    def __init__(self, browser, width=1280):
        self.context = browser.new_context(viewport={"width": width, "height": 900}, locale="ko-KR", service_workers="block")
        self.context.add_init_script("""
            localStorage.setItem('holdings', JSON.stringify([{ticker:'005930',name:'삼성전자',market:'KR',kind:'stock',qty:2,avg:60000}]));
        """)
        self.requests = []
        self.ai_requests = []
        self.modes = {"briefing": "success", "related": "success", "portfolio": "success"}
        self.errors = []
        self.context.route("**/*", self.route)
        self.page = self.context.new_page()
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))

    def count(self, kind):
        return sum(request["kind"] == kind for request in self.ai_requests)

    def numeric_count(self):
        return sum(request["path"] == "/api/portfolio-review" and request["query"].get("comment") == ["0"] for request in self.requests)

    def route(self, route):
        url = urlsplit(route.request.url)
        if not url.path.startswith("/api/"):
            if url.hostname == urlsplit(BASE).hostname:
                route.continue_()
            else:
                route.abort()
            return
        query = parse_qs(url.query)
        request = {"path": url.path, "query": query, "method": route.request.method}
        self.requests.append(request)
        kind = ({"/api/ai-briefing": "briefing", "/api/related-insight": "related"}.get(url.path)
                or ("portfolio" if url.path == "/api/portfolio-review" and query.get("comment") == ["1"] else None))
        if kind:
            self.ai_requests.append({**request, "kind": kind})
            if self.modes[kind] == "http_error":
                route.fulfill(status=503, json={"detail": "Offline verification failure"})
                return
            limit = self.modes[kind] == "daily_limit"
            ticker = query.get("ticker", ["005930"])[0]
            if kind == "briefing":
                payload = ({"available": False, "reason": "daily_limit", "retryAfter": 3600} if limit else
                           {"available": True, "summary": f"검증 브리핑 {ticker}", "stance": "중립", "bullets": ["검증 근거"]})
            elif kind == "related":
                # The existing endpoint keeps prices but omits the AI failure
                # reason on a quota error; verify its honest numbers-only UI.
                payload = {"available": True, "insight": None if limit else f"검증 관련 종목 {ticker}", "stale": False,
                           "stocks": [{"ticker": "TEST", "name": "검증 관련 기업", "role": "반도체", "changePct": 1.2}]}
            else:
                payload = {**PORTFOLIO, "reason": "daily_limit" if limit else None,
                           "comment": None if limit else {"headline": "검증 포트폴리오 코멘트", "summary": "검증 AI 설명", "watchPoints": []}}
            route.fulfill(json=payload)
            return
        if url.path == "/api/portfolio-review":
            assert query.get("comment") == ["0"], "Unclassified portfolio generation request"
            assert route.request.method == "POST"
            payload = PORTFOLIO
        elif url.path == "/api/signal":
            payload = {"available": True, "signals": [], "total": 0, "verdict": "중립", "maxScore": 5,
                       "price": 70000, "support": [], "resistance": [], "asOf": TODAY, "source": "검증"}
        elif url.path == "/api/prices":
            payload = CANDLES
        elif url.path == "/api/watchlist":
            payload = [{"ticker": ticker, "candles": CANDLES} for ticker in query.get("tickers", [""])[0].split(",")]
        elif url.path == "/api/forecast":
            payload = {"band": [], "last": 70000, "sigma": 0.01}
        elif url.path == "/api/signal-history":
            payload = {"buy": None, "sell": None, "recent": [], "horizon": 5, "evaluated": 0}
        elif url.path == "/api/fx":
            payload = {"usdkrw": 1300}
        elif url.path == "/api/daily-report":
            payload = {"date": TODAY, "summary": "검증 시장 요약", "tags": []}
        elif url.path == "/api/calendar":
            payload = {"events": [], "sources": [], "fetchedAt": TODAY + "T00:00:00Z", "timezone": "Asia/Seoul"}
        elif url.path == "/api/alert-invite":
            payload = {"available": False}
        else:
            # Unrelated panels may show an unavailable state. Never pass through
            # any unrecognized API request to a live provider or model.
            route.fulfill(status=503, json={"detail": "Unrelated offline fixture"})
            return
        route.fulfill(json=payload)

    def ready(self):
        self.page.wait_for_load_state("networkidle")
        assert not self.errors, self.errors

    def home(self):
        if not self.page.url.startswith(BASE):
            self.page.goto(BASE)
        else:
            self.page.get_by_role("button", name="스톡 인사이트 홈", exact=True).click()
        expect(self.page.locator(".portfolio-review")).to_be_visible()
        self.ready()

    def signal(self, ticker="005930"):
        if not self.page.url.startswith(BASE):
            self.page.goto(BASE + "/#tab=signal&ticker=" + ticker + "&market=KR")
        else:
            self.page.get_by_role("button", name="삼성전자 분석 열기", exact=True).click()
        expect(self.page.get_by_role("heading", name="AI 브리핑", exact=True)).to_be_visible()
        expect(self.page.get_by_role("heading", name="관련 종목 흐름", exact=True)).to_be_visible()
        self.ready()

    def section(self, title):
        return self.page.locator("section").filter(has=self.page.get_by_role("heading", name=title, exact=True)).last

    def refresh(self):
        button = self.page.get_by_role("button", name="새로고침", exact=True)
        button.click()
        expect(button).to_be_enabled()
        self.ready()

    def close(self):
        assert not self.errors, self.errors
        self.context.close()


def gating(browser):
    h = Harness(browser)
    h.home()
    assert h.numeric_count() >= 1
    assert not h.ai_requests, h.ai_requests
    before_numbers = h.numeric_count()
    h.refresh()
    assert h.numeric_count() > before_numbers, "Global refresh did not refresh numeric diagnosis"
    assert not h.ai_requests, h.ai_requests
    portfolio = h.page.locator(".portfolio-review")
    portfolio.get_by_role("button", name="포트폴리오 AI 진단 요청", exact=True).click()
    expect(portfolio).to_contain_text("검증 포트폴리오 코멘트")
    assert h.count("portfolio") == 1
    h.refresh()
    assert h.count("portfolio") == 1

    h.signal()
    assert h.count("briefing") == h.count("related") == 0
    h.refresh()
    assert h.count("briefing") == h.count("related") == 0
    h.section("AI 브리핑").get_by_role("button", name="AI 분석 요청", exact=True).click()
    expect(h.section("AI 브리핑")).to_contain_text("검증 브리핑 005930")
    assert h.count("briefing") == 1
    h.section("관련 종목 흐름").get_by_role("button", name="관련 종목 AI 분석 요청", exact=True).click()
    expect(h.section("관련 종목 흐름")).to_contain_text("검증 관련 종목 005930")
    assert h.count("related") == 1
    h.refresh()
    assert h.count("briefing") == h.count("related") == 1

    chooser = h.page.get_by_role("group", name="분석 종목 선택", exact=True)
    chooser.get_by_role("button", name="SK하이닉스 (한국)", exact=True).click()
    expect(h.section("AI 브리핑").get_by_role("button", name="AI 분석 요청", exact=True)).to_be_visible()
    h.ready()
    assert h.count("briefing") == h.count("related") == 1
    h.section("AI 브리핑").get_by_role("button", name="AI 분석 요청", exact=True).click()
    expect(h.section("AI 브리핑")).to_contain_text("검증 브리핑 000660")
    h.section("관련 종목 흐름").get_by_role("button", name="관련 종목 AI 분석 요청", exact=True).click()
    expect(h.section("관련 종목 흐름")).to_contain_text("검증 관련 종목 000660")
    assert h.count("briefing") == h.count("related") == 2
    chooser.get_by_role("button", name="삼성전자 (한국)", exact=True).click()
    expect(h.section("AI 브리핑")).to_contain_text("검증 브리핑 005930")
    expect(h.section("관련 종목 흐름")).to_contain_text("검증 관련 종목 005930")
    h.refresh()
    assert h.count("briefing") == h.count("related") == 2
    h.home()
    expect(h.page.locator(".portfolio-review")).to_contain_text("검증 포트폴리오 코멘트")
    assert h.count("portfolio") == 1
    h.page.reload()
    expect(h.page.locator(".portfolio-review").get_by_role("button", name="포트폴리오 AI 진단 요청", exact=True)).to_be_visible()
    h.ready()
    assert h.count("portfolio") == 1, "Browser reload automatically regenerated a comment"
    result = {"case": "entry, ticker switch, global refresh, cached re-entry and reload", "passed": True,
              "manualAiRequests": dict(Counter(request["kind"] for request in h.ai_requests)), "numericRequests": h.numeric_count()}
    h.close()
    return result


def failures(browser):
    h = Harness(browser, width=390)
    h.signal()
    briefing = h.section("AI 브리핑")
    h.modes["briefing"] = "http_error"
    briefing.get_by_role("button", name="AI 분석 요청", exact=True).click()
    expect(briefing).to_contain_text("AI 분석을 가져오지 못했습니다")
    h.page.wait_for_timeout(1200)  # A default TanStack retry would fire after 1s.
    h.ready()
    assert h.count("briefing") == 1, "Failed AI request retried automatically"
    h.modes["briefing"] = "daily_limit"
    briefing.get_by_role("button", name="AI 분석 다시 요청", exact=True).click()
    expect(briefing).to_contain_text("오늘의 AI 생성 한도")
    expect(briefing.get_by_role("button", name="AI 분석 다시 요청", exact=True)).to_be_enabled()
    assert h.count("briefing") == 2
    h.modes["briefing"] = "success"
    briefing.get_by_role("button", name="AI 분석 다시 요청", exact=True).click()
    expect(briefing).to_contain_text("검증 브리핑 005930")
    assert h.count("briefing") == 3
    h.modes["briefing"] = "http_error"
    briefing.get_by_role("button", name="AI 분석 다시 확인", exact=True).click()
    expect(briefing).to_contain_text("연결하지 못해 이전 분석을 표시합니다")
    expect(briefing).to_contain_text("검증 브리핑 005930")

    related = h.section("관련 종목 흐름")
    h.modes["related"] = "http_error"
    related.get_by_role("button", name="관련 종목 AI 분석 요청", exact=True).click()
    expect(related).to_contain_text("관련 종목 분석을 가져오지 못했습니다")
    h.page.wait_for_timeout(1200)
    h.ready()
    assert h.count("related") == 1
    h.modes["related"] = "daily_limit"
    related.get_by_role("button", name="관련 종목 AI 분석 요청", exact=True).click()
    expect(related).to_contain_text("AI 요약을 받지 못해 관련 종목 시세만 표시합니다")
    expect(related).to_contain_text("검증 관련 기업")
    assert h.count("related") == 2
    h.modes["related"] = "success"
    related.get_by_role("button", name="관련 종목 AI 분석 다시 확인", exact=True).click()
    expect(related).to_contain_text("검증 관련 종목 005930")
    assert h.count("related") == 3

    h.home()
    portfolio = h.page.locator(".portfolio-review")
    h.modes["portfolio"] = "http_error"
    portfolio.get_by_role("button", name="포트폴리오 AI 진단 요청", exact=True).click()
    expect(portfolio).to_contain_text("AI 코멘트를 받지 못해 수치 관찰만 표시합니다")
    h.page.wait_for_timeout(1200)
    expect(portfolio).to_contain_text("검증 수치: 삼성전자 비중 100%")
    h.ready()
    assert h.count("portfolio") == 1
    h.modes["portfolio"] = "daily_limit"
    portfolio.get_by_role("button", name="포트폴리오 AI 진단 요청", exact=True).click()
    expect(portfolio).to_contain_text("오늘의 AI 생성 한도")
    expect(portfolio.get_by_role("button", name="포트폴리오 AI 진단 요청", exact=True)).to_be_enabled()
    expect(portfolio).to_contain_text("검증 수치: 삼성전자 비중 100%")
    assert h.count("portfolio") == 2
    h.page.evaluate("window.scrollTo({top: 0, behavior: 'instant'})")
    h.page.screenshot(path=str(OUT / "manual-ai-quota-mobile.png"), full_page=True)
    h.modes["portfolio"] = "success"
    portfolio.get_by_role("button", name="포트폴리오 AI 진단 요청", exact=True).click()
    expect(portfolio).to_contain_text("검증 포트폴리오 코멘트")
    assert h.count("portfolio") == 3
    h.refresh()
    assert h.count("portfolio") == 3
    h.modes["portfolio"] = "http_error"
    portfolio.get_by_role("button", name="포트폴리오 AI 진단 다시 확인", exact=True).click()
    expect(portfolio).to_contain_text("검증 포트폴리오 코멘트")
    expect(portfolio.get_by_role("status")).to_contain_text(re.compile(r"(?:연결|실패).*(?:이전|직전)|(?:이전|직전).*(?:연결|실패)"))
    assert h.count("portfolio") == 4
    result = {"case": "HTTP failure, quota, numeric fallback and manual recovery", "passed": True,
              "manualAiRequests": dict(Counter(request["kind"] for request in h.ai_requests))}
    h.close()
    return result


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    results = [gating(browser), failures(browser)]
    browser.close()
print(json.dumps(results, ensure_ascii=False, indent=2))
