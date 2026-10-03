"""Offline economic-briefing UI regression checks; all API calls are intercepted.

Run: python scripts/verify_public_briefing.py [http://127.0.0.1:8123]
"""

from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8123"
assert urlsplit(BASE).hostname in {"localhost", "127.0.0.1"}, "Use a local app only"
OUT = Path(__file__).resolve().parents[1] / ".qa" / "public-briefing"
OUT.mkdir(parents=True, exist_ok=True)
DAY = "2026-10-04"
NOW = datetime(2026, 10, 4, 4, 0, tzinfo=timezone.utc)  # 13:00 Korean time
READY = {
    "date": DAY, "slot": "noon", "label": "점심", "timezone": "Asia/Seoul",
    "scheduledAt": DAY + "T12:00:00+09:00", "status": "ready", "available": True,
    "message": "기사 제목을 모았습니다. 자세한 내용은 원문에서 확인하세요.",
    "generatedAt": DAY + "T13:00:00+09:00", "windowStart": DAY + "T07:00:00+09:00",
    "windowEnd": DAY + "T13:00:00+09:00", "backfillStart": "2026-10-03T13:00:00+09:00",
    "backfillCount": 1, "retryAfter": 0, "mode": "rss_headlines",
    "items": [{"id": str(index), "title": f"[화면 검증용] 경제와 주식 시장의 주요 이슈 제목 {index}",
               "source": f"검증 출처 {index}", "url": f"https://example.com/article/{index}",
               "publishedAt": DAY + ("T06:00:00+09:00" if index == 7 else "T11:00:00+09:00"),
               "previousWindow": index == 7} for index in range(1, 8)],
    "sources": [{"name": "검증 출처", "status": "ok"}, {"name": "부분 실패 출처", "status": "partial"}],
}


def run(browser, width):
    context = browser.new_context(viewport={"width": width, "height": 900}, locale="ko-KR", service_workers="block")
    state = {"mode": "ready"}
    requests, page_errors = [], []

    def route_request(route):
        url = urlsplit(route.request.url)
        if url.path.startswith("/api/"):
            if url.path != "/api/public-briefing":
                route.fulfill(status=503, json={"detail": "Offline briefing verification"})
                return
            assert route.request.method == "GET", "Public briefings must never send a mutation"
            requests.append(route.request.url)
            params = parse_qs(url.query)
            mode = state["mode"]
            if mode == "network_error":
                route.fulfill(status=503, json={"detail": "Offline failure fixture"})
                return
            data = deepcopy(READY)
            data["date"] = params["date"][0]
            data["slot"] = params["slot"][0]
            if mode != "not_started" and (data["date"] != DAY or data["slot"] == "morning"):
                mode = "archive_unavailable"
            if mode != "ready":
                data.update(status=mode, available=False, items=[], sources=[], generatedAt=None,
                            windowStart=None, windowEnd=None, backfillCount=0, backfillStart=None)
                data["message"] = {
                    "archive_unavailable": "이 시간대에 저장된 브리핑이 없어요. 현재 시간대의 브리핑을 확인해 주세요.",
                    "unavailable": "최근 24시간 내 발행시각이 확인된 기사를 확보하지 못했어요.",
                    "building": "브리핑을 모으는 중이에요. 잠시 후 다시 확인해 주세요.",
                    "not_started": "아침 브리핑은 한국시간 07:00 이후 확인할 수 있어요.",
                }[mode]
                data["retryAfter"] = 600 if mode == "unavailable" else 5 if mode == "building" else 0
            route.fulfill(json=data)
        elif url.hostname == urlsplit(BASE).hostname:
            route.continue_()
        else:
            route.abort()

    context.route("**/*", route_request)
    page = context.new_page()
    page.clock.install(time=NOW)
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.goto(BASE)
    card = page.locator(".public-briefing")
    card.scroll_into_view_if_needed()
    expect(card.get_by_role("heading", name="경제 브리핑")).to_be_visible()
    expect(card.locator("ol li")).to_have_count(7)
    expect(card).to_contain_text("수집 구간:")
    expect(card).to_contain_text("07:00")
    expect(card).to_contain_text("13:00")
    expect(card).to_contain_text("최근 24시간 기사 1건")
    expect(card).to_contain_text("부분 실패 출처(일부)")
    expect(card).to_contain_text("정시에 자동 생성하지 않으며")
    expect(card).to_contain_text("서버가 재시작하면 이전 기록이 없어질 수 있어요")
    expect(card.get_by_role("button", name="점심 12:00")).to_have_attribute("aria-pressed", "true")
    expect(card.get_by_role("button", name="저녁 18:00")).to_be_disabled()
    expect(card.locator("ol a").first).to_have_attribute("href", "https://example.com/article/1")
    expect(card.locator("ol time").first).to_have_attribute("datetime", DAY + "T11:00:00+09:00")
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    card.screenshot(path=str(OUT / f"ready-{width}.png"))

    # No periodic refresh, no stale-fallback misrepresentation after a request fails.
    initial_requests = len(requests)
    page.clock.run_for(61_000)
    assert len(requests) == initial_requests
    state["mode"] = "network_error"
    card.get_by_role("button", name="다시 조회", exact=True).click()
    expect(card).to_contain_text("마지막으로 확인한 브리핑을 표시합니다")
    expect(card.locator("ol li")).to_have_count(7)

    state["mode"] = "ready"
    card.get_by_role("button", name="아침 07:00").click()
    expect(card).to_contain_text("이 시간대에 저장된 브리핑이 없어요")
    expect(card.locator("ol li")).to_have_count(0)
    card.get_by_role("button", name="현재 브리핑 보기").click()
    expect(card.locator("ol li")).to_have_count(7)
    card.locator('input[type="date"]').fill("2026-10-03")
    expect(card).to_contain_text("이 시간대에 저장된 브리핑이 없어요")
    expect(card.get_by_role("button", name="저녁 18:00")).to_be_enabled()
    card.get_by_role("button", name="현재 시간대", exact=True).click()
    expect(card.locator("ol li")).to_have_count(7)

    for mode, expected in [("unavailable", "약 10분 뒤 다시 확인"), ("building", "브리핑을 모으는 중이에요")]:
        state["mode"] = mode
        card.get_by_role("button", name="다시 조회", exact=True).click()
        expect(card).to_contain_text(expected)
        expect(card.locator("ol li")).to_have_count(0)

    # A fresh page with no stored result must show a recoverable error.
    state["mode"] = "network_error"
    page.reload()
    expect(card).to_contain_text("경제 브리핑을 불러오지 못했어요")
    expect(card.get_by_role("button", name="다시 시도", exact=True)).to_be_visible()

    state["mode"] = "not_started"
    page.clock.set_system_time(datetime(2026, 10, 3, 21, 0, tzinfo=timezone.utc))
    page.reload()
    expect(card).to_contain_text("아침 브리핑은 한국시간 07:00 이후 확인할 수 있어요")
    for slot in ("아침 07:00", "점심 12:00", "저녁 18:00"):
        expect(card.get_by_role("button", name=slot)).to_be_disabled()
    expect(card.locator("ol li")).to_have_count(0)
    assert not page_errors, page_errors
    context.close()
    return {"width": width, "passed": True, "states": 7, "realApiCalls": 0}


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    results = [run(browser, width) for width in (1280, 360)]
    browser.close()
print(json.dumps(results, ensure_ascii=False, indent=2))
