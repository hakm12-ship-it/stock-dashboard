"""Offline calendar UI checks against a running local build; no real API calls.

Run: python scripts/verify_calendar_personalization.py [http://127.0.0.1:8000]
Every API response is a fixture and all external requests are blocked.
"""

import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
assert urlsplit(BASE).hostname in {"127.0.0.1", "localhost"}, "Use a local build only"
OUT = Path(__file__).resolve().parents[1] / ".qa" / "calendar-personalization"
OUT.mkdir(parents=True, exist_ok=True)
NOW = datetime.now(timezone(timedelta(hours=9)))
DATE = NOW.strftime("%Y-%m-") + "15"


def event(identifier, title, category, ticker=None):
    return {
        "id": identifier, "title": title, "category": category, "country": "US",
        "date": DATE, "startAt": None, "timeStatus": "tentative", "importance": "high",
        "source": "일정 검증 출처", "sourceUrl": "https://example.com/calendar", "ticker": ticker,
    }


EVENTS = [event("aapl", "애플 실적 발표", "earnings", "AAPL"),
          event("nvda", "엔비디아 실적 발표", "earnings", "NVDA"),
          event("fed", "FOMC 금리 결정", "rates"), event("cpi", "소비자물가지수", "economic")]


def no_overflow(page):
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")


def run(browser, width, personal=True):
    context = browser.new_context(viewport={"width": width, "height": 900}, service_workers="block", locale="ko-KR")
    requests, page_errors = [], []
    if personal:
        context.add_init_script("""
            localStorage.setItem('customTickers', JSON.stringify([{ticker:'AAPL',name:'애플',short:'애플',market:'US',kind:'stock'}]));
            localStorage.setItem('holdings', JSON.stringify([{ticker:'NVDA',name:'엔비디아',market:'US',kind:'stock',qty:2,avg:100}]));
        """)

    def route_request(route):
        url = urlsplit(route.request.url)
        if url.path.startswith("/api/"):
            assert route.request.method == "GET", "Calendar checks must never send a mutation"
            requests.append(route.request.url)
            if url.path == "/api/calendar":
                payload = {"events": EVENTS, "sources": [{"name": "일정 검증 출처", "url": "https://example.com/calendar", "status": "ok"}], "fetchedAt": NOW.isoformat(), "timezone": "Asia/Seoul"}
            elif url.path == "/api/calendar/notification-status":
                payload = {"enabled": False, "ready": False, "schedulerActive": False, "times": ["07:00", "12:00", "18:00"]}
            elif url.path == "/api/alert-invite":
                payload = {"available": False}
            else:
                # Navigation targets may load other panels. Keep their data
                # explicitly unavailable instead of contacting a real provider.
                route.fulfill(status=503, json={"detail": "Offline calendar verification"})
                return
            route.fulfill(json=payload)
        elif url.hostname == urlsplit(BASE).hostname:
            route.continue_()
        else:
            route.abort()

    context.route("**/*", route_request)
    page = context.new_page()
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.goto(BASE + "/calendar")
    expect(page.get_by_role("heading", name="경제 캘린더", exact=True)).to_be_visible()
    expect(page.locator(".calendar-event")).to_have_count(4)
    expect(page.locator(".calendar-coverage")).to_contain_text("빅테크 7개")
    expect(page.locator('meta[name="robots"]')).to_have_attribute("content", re.compile("index, ?follow"))
    canonical = page.locator('link[rel="canonical"]').get_attribute("href")
    description = page.locator('meta[name="description"]').get_attribute("content")
    assert canonical.endswith("/calendar")
    initial_requests = list(requests)
    scopes = page.get_by_role("group", name="일정 대상", exact=True)

    scopes.get_by_role("button", name="관심종목", exact=True).click()
    expect(page.locator('meta[name="robots"]')).to_have_attribute("content", "noindex, nofollow")
    expect(page.locator(".calendar-event")).to_have_count(3 if personal else 2)
    expect(page.locator(".calendar-event").filter(has_text="엔비디아 실적 발표")).to_have_count(0)
    scopes.get_by_role("button", name="보유종목", exact=True).click()
    expect(page.locator(".calendar-event")).to_have_count(3 if personal else 2)
    expect(page.locator(".calendar-event").filter(has_text="애플 실적 발표")).to_have_count(0)
    page.get_by_role("checkbox", name="금리·경제지표도 함께 보기", exact=True).uncheck()
    expect(page.locator(".calendar-event")).to_have_count(1 if personal else 0)
    if personal:
        expect(page.get_by_role("link", name="NVDA 차트 보기", exact=True)).to_be_visible()
        expect(page.get_by_role("link", name="NVDA 종합 분석", exact=True)).to_be_visible()
        expect(page.locator(".calendar-event .calendar-source-link")).to_have_attribute("href", "https://example.com/calendar")
    else:
        expect(page.get_by_text("현재 보유종목에는 실적 수집 대상 기업이 없어요.", exact=False)).to_be_visible()
    no_overflow(page)
    page.evaluate("window.scrollTo({top: 0, behavior: 'instant'})")
    page.wait_for_function("window.scrollY === 0")
    page.screenshot(path=str(OUT / f"calendar-{width}-{'personal' if personal else 'empty'}.png"), full_page=True)
    assert requests == initial_requests, "Local filters triggered an API request"
    assert page.url == BASE + "/calendar", "Personal filters leaked into the URL"
    assert page.locator('link[rel="canonical"]').get_attribute("href") == canonical
    assert page.locator('meta[name="description"]').get_attribute("content") == description
    assert not page_errors, page_errors

    scopes.get_by_role("button", name="전체 일정", exact=True).click()
    expect(page.locator(".calendar-event")).to_have_count(4)
    expect(page.locator('meta[name="robots"]')).to_have_attribute("content", re.compile("index, ?follow"))
    if personal:
        # A held stock need not already be in the watchlist to open correctly.
        scopes.get_by_role("button", name="보유종목", exact=True).click()
        page.get_by_role("link", name="NVDA 차트 보기", exact=True).click()
        expect(page).to_have_url(re.compile(r"tab=tech&ticker=NVDA&market=US"))
        expect(page.get_by_role("heading", name="차트", exact=True)).to_be_visible()
        expect(page.locator('meta[name="robots"]')).to_have_attribute("content", re.compile("index, ?follow"))
        page.go_back()
        expect(page.get_by_role("heading", name="경제 캘린더", exact=True)).to_be_visible()
        page.get_by_role("link", name="NVDA 종합 분석", exact=True).click()
        expect(page).to_have_url(re.compile(r"tab=signal&ticker=NVDA&market=US"))
        expect(page.get_by_role("heading", name="종합 분석", exact=True)).to_be_visible()
    context.close()
    return {"width": width, "personal": personal, "passed": True, "filterApiRequests": 0}


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    results = [run(browser, width) for width in (1280, 360)]
    results.append(run(browser, 390, personal=False))
    browser.close()
print(json.dumps(results, ensure_ascii=False, indent=2))
