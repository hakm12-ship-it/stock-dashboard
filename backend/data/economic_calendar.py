"""Live economic calendar, with explicit provenance and no invented release dates.

Official calendars supply macro releases. Yahoo's next earnings date is a
provider estimate (date only), never a confirmed time. Successful schedules are
shared for six hours across views and alerts. Failed sources back off for at
least 15 minutes; stale schedules are not used for alerts.
"""

from __future__ import annotations

from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
from html import unescape
import re
import threading
import time
from typing import Callable
from zoneinfo import ZoneInfo

import requests


KST = timezone(timedelta(hours=9))
UTC = timezone.utc
FED_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
BLS_URL = "https://www.bls.gov/schedule/news_release/bls.ics"
BEA_URL = "https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics"
BOK_URL = "https://www.bok.or.kr/portal/singl/crncyPolicyDrcMtg/listYear.do?menuNo=200755&mtgSe=A"
NYFED_URL = "https://www.newyorkfed.org/research/calendars/i-{month}{year}.html"
TICKERS = {"AAPL": "애플", "MSFT": "마이크로소프트", "GOOGL": "알파벳", "AMZN": "아마존", "META": "메타", "NVDA": "엔비디아", "TSLA": "테슬라"}
_MONTHS = {name.lower(): i for i, name in enumerate(("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"), 1)}
_POOL = ThreadPoolExecutor(max_workers=8, thread_name_prefix="calendar")
_CACHE: OrderedDict[str, tuple[float, list[dict], dict, str]] = OrderedDict()
_LOCK = threading.Lock()
_SOURCE_LOCKS = [threading.Lock() for _ in range(32)]
_SUCCESS_TTL = 6 * 60 * 60
_FAILURE_TTL = 15 * 60
_BLOCKED_TTL = 60 * 60


def _download(url: str) -> str:
    """Bound connect/read time, total streaming time, and response size."""
    deadline = time.monotonic() + 8
    with requests.get(url, headers={"User-Agent": "Mozilla/5.0 (compatible; StockInsightCalendar/1.0)"}, timeout=(2, 4), stream=True) as response:
        response.raise_for_status()
        chunks, size = [], 0
        for chunk in response.iter_content(65536):
            size += len(chunk)
            if size > 3_000_000 or time.monotonic() > deadline:
                raise ValueError("일정 응답이 크거나 응답 제한 시간을 초과했습니다.")
            chunks.append(chunk)
        return b"".join(chunks).decode("utf-8-sig")


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def _event(key: str, title: str, category: str, country: str, when: date | datetime, status: str, source: str, url: str, **extra) -> dict:
    timed = isinstance(when, datetime)
    if timed and when.tzinfo is None:
        raise ValueError("A timed calendar event requires an explicit timezone")
    day = when.astimezone(KST).date() if timed else when
    # ICS callers include the publisher UID: two different reference periods can
    # be released on the same day and must not overwrite one another.
    identity = sha256(f"{key}:{day.isoformat()}".encode()).hexdigest()[:20]
    return {"id": f"cal-{identity}", "title": title, "category": category, "country": country,
            "startAt": when.astimezone(UTC).isoformat() if timed else None,
            "date": day.isoformat(), "timeStatus": status, "importance": "high",
            "source": source, "sourceUrl": url, **extra}


def _indicator(summary: str) -> tuple[str, str] | None:
    s = summary.lower()
    if s.startswith("consumer price index"):
        return "cpi", "미국 소비자물가지수 (CPI)"
    if s.startswith("employment situation") or s.startswith("the employment situation"):
        return "employment", "미국 고용보고서 (비농업 고용·실업률)"
    if s.startswith("producer price index"):
        return "ppi", "미국 생산자물가지수 (PPI)"
    if s.startswith("personal income and outlays"):
        return "pce", "미국 개인소득·소비지출 (PCE 물가)"
    if s.startswith("gross domestic product,") or re.match(r"gdp\s*\(", s):
        phase = "속보치" if "advance" in s else "잠정치" if "second" in s else "확정치" if "third" in s else ""
        return "gdp", "미국 GDP" + (f" ({phase})" if phase else "")
    return None


def _ical_value(value: str) -> str:
    return re.sub(r"\\([nN,;\\])", lambda m: "\n" if m[1].lower() == "n" else m[1], value)


def _parse_ics(payload: str, source: str, url: str) -> list[dict]:
    if "BEGIN:VCALENDAR" not in payload or "END:VCALENDAR" not in payload:
        raise ValueError("공식 캘린더 형식을 확인할 수 없습니다.")
    payload = re.sub(r"\r?\n[ \t]", "", payload)
    # A later cancellation/revision replaces a previous VEVENT with the same UID.
    records = {}
    for index, block in enumerate(re.findall(r"BEGIN:VEVENT\s*\n(.*?)END:VEVENT", payload, re.S)):
        fields = {}
        for line in block.splitlines():
            if ":" not in line:
                continue
            name, value = line.split(":", 1)
            parts = name.split(";")
            params = dict(part.split("=", 1) for part in parts[1:] if "=" in part)
            fields[parts[0]] = (params, value)
        uid = fields.get("UID", ({}, str(index)))[1]
        sequence = int(fields.get("SEQUENCE", ({}, "0"))[1])
        previous = records.get(uid)
        if previous is None or sequence >= previous[0]:
            records[uid] = (sequence, fields)
    events = []
    for uid, (_, fields) in records.items():
        status = fields.get("STATUS", ({}, ""))[1].upper()
        if status == "CANCELLED":
            continue
        summary = _ical_value(fields.get("SUMMARY", ({}, ""))[1])
        kind = _indicator(summary)
        if not kind:
            continue
        if any(field in fields for field in ("RRULE", "RDATE", "RECURRENCE-ID")):
            raise ValueError("반복 일정 형식이 변경되어 원본 캘린더 확인이 필요합니다.")
        params, value = fields["DTSTART"]
        if params.get("VALUE") == "DATE" or re.fullmatch(r"\d{8}", value):
            when = datetime.strptime(value, "%Y%m%d").date()
            time_status = "tentative" if status == "TENTATIVE" else "date_only"
        else:
            utc = value.endswith("Z")
            when = datetime.strptime(value.removesuffix("Z"), "%Y%m%dT%H%M%S")
            tzid = params.get("TZID", "America/New_York").strip('"')
            tzid = {"US-Eastern": "America/New_York", "Eastern Standard Time": "America/New_York"}.get(tzid, tzid)
            when = when.replace(tzinfo=UTC if utc else ZoneInfo(tzid))
            time_status = "tentative" if status == "TENTATIVE" else "confirmed"
        events.append(_event(f"{source}:{kind[0]}:{uid}", kind[1], "economic", "US", when, time_status, source, url, description=summary))
    if not events:
        raise ValueError("CPI·고용·PCE·GDP 등 주요 일정이 아직 공개되지 않았거나 형식이 변경되었습니다.")
    return events


def _parse_fed(payload: str) -> list[dict]:
    headers = list(re.finditer(r"(\d{4})\s+FOMC Meetings", payload))
    events = []
    for index, heading in enumerate(headers):
        section = payload[heading.end():headers[index + 1].start() if index + 1 < len(headers) else len(payload)]
        pairs = re.findall(r'<div[^>]*class="[^"]*fomc-meeting__month[^\"]*"[^>]*>(.*?)</div>\s*<div[^>]*class="[^"]*fomc-meeting__date[^\"]*"[^>]*>(.*?)</div>', section, re.S)
        for month_html, day_html in pairs:
            month_text, day_text = _text(month_html), _text(day_html)
            # Unscheduled conference calls and notation votes have no standard release time.
            if "unscheduled" in day_text.lower() or "notation" in day_text.lower():
                continue
            month = _MONTHS.get(month_text.split("/")[-1].strip().lower())
            days = re.match(r"\s*(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?", day_text)
            if not month or not days:
                continue
            when = datetime(int(heading[1]), month, int(days[2] or days[1]), 14, tzinfo=ZoneInfo("America/New_York"))
            events.append(_event("fomc", "미국 FOMC 금리 결정", "rates", "US", when, "tentative", "Federal Reserve", FED_URL,
                                 description="공식 회의 마지막 날 기준. 발표 시각은 미국 동부 14시 관례를 적용한 예상이며, 회의 일정과 시각은 변경될 수 있습니다."))
    if not events:
        raise ValueError("FOMC 회의 일정을 읽지 못했습니다.")
    return events


def _parse_bok(payload: str, year: int, url: str) -> list[dict]:
    selected = re.search(r'<option\b[^>]*value=["\'](\d{4})["\'][^>]*selected', payload)
    if not selected or int(selected[1]) != year:
        raise ValueError(f"한국은행 {year}년 일정이 아직 공개되지 않았습니다.")
    table = re.search(r'<table\b[^>]*id=["\']tableId["\'][^>]*>(.*?)</table>', payload, re.S)
    events = []
    for value in re.findall(r'<th\b[^>]*scope=["\']row["\'][^>]*>(.*?)</th>', table[1] if table else "", re.S):
        parts = re.search(r"(\d{1,2})\s*월\s*(\d{1,2})\s*일", _text(value))
        if parts:
            when = date(year, int(parts[1]), int(parts[2]))
            events.append(_event("bok", "한국은행 금융통화위원회 금리 결정", "rates", "KR", when, "date_only", "한국은행", url,
                                 description="공식 통화정책방향 결정회의 날짜입니다. 정확한 발표 시각은 미정입니다."))
    if not events:
        raise ValueError("한국은행 회의 일정을 읽지 못했습니다.")
    return events


def _parse_earnings(payload: str, ticker: str, url: str) -> list[dict]:
    # Yahoo's visible summary is small and explicit; do not scrape unrelated dates
    # from scripts or silently turn a provider date range into a precise event.
    row = re.search(r'<li\b[^>]*>(?:(?!</li>).)*title="Earnings Date(?: \(est\.\))?"(?:(?!</li>).)*</li>', payload, re.S)
    value = re.search(r'<span\b[^>]*class="[^"]*\bvalue\b[^\"]*"[^>]*>(.*?)</span>', row[0] if row else "", re.S)
    label = _text(value[1]) if value else ""
    if not re.fullmatch(r"[A-Za-z]{3} \d{1,2}, \d{4}", label):
        raise ValueError("다음 실적일이 미공개이거나 날짜 범위로만 제공됩니다.")
    when = datetime.strptime(label, "%b %d, %Y").date()
    return [_event(f"earnings-{ticker}", f"{TICKERS[ticker]} ({ticker}) 실적 발표", "earnings", "US", when, "tentative", "Yahoo Finance", url,
                   ticker=ticker, description="데이터 제공사의 예상 실적일(미국 현지 날짜)입니다. 회사 IR로 확정 여부와 발표 시각을 확인해야 합니다.")]


def _parse_fred(payload: str, key: str, title: str, url: str) -> list[dict]:
    if "All times are US Central Time" not in payload:
        raise ValueError("FRED 일정의 시간대를 확인할 수 없습니다.")
    events, current_day = [], None
    table = payload[payload.find('id="release-dates-pager"'):]
    for row in re.findall(r"<tr\b[^>]*>(.*?)</tr>", table, re.S):
        text = _text(row)
        match = re.search(r"(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) ([A-Za-z]+ \d{1,2}, \d{4})", text)
        if match:
            current_day = datetime.strptime(match[1], "%B %d, %Y").date()
            continue
        clock = re.search(r"\b(\d{1,2}:\d{2}\s*[ap]m)\b", text, re.I)
        if current_day and "/release?rid=" in row:
            when = datetime.combine(current_day, datetime.strptime(clock[1].upper(), "%I:%M %p").time(), ZoneInfo("America/Chicago")) if clock else current_day
            events.append(_event(key, title, "economic", "US", when, "confirmed" if clock else "date_only", "FRED · St. Louis Fed", url,
                                 description="BLS 공식 일정 직접 조회가 불가능하여 세인트루이스 연준의 공개 발표 일정을 사용합니다."))
    if not events:
        raise ValueError("FRED에 해당 연도 주요 일정이 아직 공개되지 않았습니다.")
    return events


def _nyfed_url(year: int, month: int) -> str:
    name = list(_MONTHS)[month - 1][:3]
    return NYFED_URL.format(month=name, year=f"{year % 100:02}")


def _parse_nyfed(payload: str, year: int, month: int, url: str) -> list[dict]:
    """The NY Fed's public monthly calendar is independent of BLS/FRED hosts."""
    plain = _text(payload)
    month_name = list(_MONTHS)[month - 1].title()
    if "all Eastern Time" not in plain or f"{month_name} {year}" not in plain:
        raise ValueError("뉴욕연준 일정의 해당 월과 시간대를 확인할 수 없습니다.")
    events = []
    for cell in re.findall(r"<td\b[^>]*>(.*?)</td>", payload, re.S | re.I):
        day = re.match(r"(\d{1,2})\s", _text(cell))
        if not day:
            continue
        # Each anchor is followed by its own release clock. Do not borrow the
        # next event's time when the publisher omits or cancels an event's clock.
        for anchor in re.finditer(r"<a\b[^>]*>(.*?)</a>((?:(?!<a\b).)*)", cell, re.S | re.I):
            summary = _text(anchor[1])
            kind = _indicator(summary)
            if not kind or kind[0] not in {"cpi", "employment", "ppi"}:
                continue
            clock = re.search(r"\((\d{2}):(\d{2})\)", _text(anchor[2]))
            when = (datetime(year, month, int(day[1]), int(clock[1]), int(clock[2]), tzinfo=ZoneInfo("America/New_York"))
                    if clock else date(year, month, int(day[1])))
            events.append(_event(kind[0], kind[1], "economic", "US", when, "tentative", "Federal Reserve Bank of New York", url,
                                 description=f"{summary}. 뉴욕연준이 공개한 예상 일정입니다. 날짜와 시각은 변경될 수 있으며 확정 발표 전 알림에는 사용하지 않습니다."))
    if not events:
        raise ValueError("뉴욕연준에 이달 CPI·고용·PPI 일정이 아직 공개되지 않았거나 형식이 변경되었습니다.")
    return events


def _load(name: str, url: str, parser: Callable[[str], list[dict]]) -> tuple[list[dict], dict, str]:
    # Striped per-source locks prevent repeated requests when the page and alert
    # scheduler refresh simultaneously, without serialising independent sources.
    # Cache by provider URL, not the user's date range: changing calendar months
    # must not trigger another download of the same annual/next-release schedule.
    with _SOURCE_LOCKS[int(sha256(url.encode()).hexdigest()[:8], 16) % len(_SOURCE_LOCKS)]:
        now = time.monotonic()
        with _LOCK:
            cached = _CACHE.get(url)
            if cached and cached[0] > now:
                _CACHE.move_to_end(url)
                return deepcopy(cached[1:])
        fetched = datetime.now(UTC).isoformat()
        try:
            events = parser(_download(url))
            status = {"name": name, "url": url, "status": "ok"}
            ttl = _SUCCESS_TTL
        except Exception as exc:
            events = []
            ttl = _FAILURE_TTL
            if isinstance(exc, requests.HTTPError):
                message = f"일정 제공처가 HTTP {exc.response.status_code} 응답을 반환했습니다."
                if exc.response.status_code in (403, 429):
                    ttl = _BLOCKED_TTL
            elif isinstance(exc, (requests.RequestException, TimeoutError)):
                message = "일정 제공처에 연결하지 못했습니다. 잠시 후 다시 조회합니다."
            else:
                message = str(exc)[:180] if isinstance(exc, ValueError) else "일정 형식을 읽지 못했습니다."
            status = {"name": name, "url": url, "status": "error", "message": message}
        status["checkedAt"] = fetched
        status["nextRefreshAt"] = (datetime.fromisoformat(fetched) + timedelta(seconds=ttl)).isoformat()
        if status["status"] == "ok":
            status["dataAsOf"] = fetched
        with _LOCK:
            _CACHE[url] = (now + ttl, events, status, fetched)
            _CACHE.move_to_end(url)
            while len(_CACHE) > 40:
                _CACHE.popitem(last=False)
        return deepcopy((events, status, fetched))


def get_calendar(start: date, end: date) -> dict:
    """Return an inclusive Korean-date range (maximum 93 days).

    ``startAt`` is UTC ISO when a clock time is available. With a null startAt,
    ``date`` retains the source's local day, and consumers must not turn it into
    an instant or send an hour-before notification. Tentative events are also
    excluded from precise-time notifications.
    """
    if end < start or (end - start).days > 92:
        raise ValueError("캘린더 조회 기간은 1~93일이어야 합니다.")
    jobs = [("Federal Reserve", FED_URL, _parse_fed),
            ("BLS", BLS_URL, lambda h: _parse_ics(h, "BLS", BLS_URL)),
            ("BEA", BEA_URL, lambda h: _parse_ics(h, "BEA", BEA_URL))]
    # BOK publishes date-only meetings in its own Korean calendar year.
    for year in range(start.year, end.year + 1):
        url = f"{BOK_URL}&pYear={year}"
        jobs.append(("한국은행", url, lambda h, y=year, u=url: _parse_bok(h, y, u)))
    for ticker in TICKERS:
        url = f"https://finance.yahoo.com/quote/{ticker}/calendar/"
        jobs.append((f"Yahoo Finance · {ticker}", url, lambda h, t=ticker, u=url: _parse_earnings(h, t, u)))
    futures = [_POOL.submit(_load, *job) for job in jobs]
    results = [future.result() for future in futures]
    if results[1][1]["status"] == "error":
        # One small official monthly page replaces the two annual FRED requests
        # that can time out in a data-centre environment. No FRED call is made
        # when the NY Fed covers the requested month successfully.
        months = []
        cursor = start.replace(day=1)
        while cursor <= end:
            year, month = cursor.year, cursor.month
            url = _nyfed_url(year, month)
            months.append((year, month, _POOL.submit(_load, f"뉴욕연준 · {year}-{month:02}", url,
                          lambda h, y=year, m=month, u=url: _parse_nyfed(h, y, m, u))))
            if (year, month) == (end.year, end.month):
                break
            cursor = date(year + (month == 12), month % 12 + 1, 1)
        failed_months = set()
        for year, month, future in months:
            result = future.result()
            results.append(result)
            if result[1]["status"] == "error":
                failed_months.add((year, month))
        fallback = []
        for year in sorted({year for year, _ in failed_months}):
            for rid, key, title in ((10, "cpi", "미국 소비자물가지수 (CPI)"), (50, "employment", "미국 고용보고서 (비농업 고용·실업률)")):
                url = f"https://fred.stlouisfed.org/releases/calendar?rid={rid}&y={year}"
                fallback.append(_POOL.submit(_load, f"FRED · {key.upper()} · {year}", url, lambda h, k=key, t=title, u=url: _parse_fred(h, k, t, u)))
        for future in fallback:
            source_events, status, fetched = future.result()
            # A failed November page must not duplicate/override a successful
            # October NY Fed page when FRED returns the entire year.
            results.append(([e for e in source_events if (int(e["date"][:4]), int(e["date"][5:7])) in failed_months], status, fetched))
    events = {event["id"]: event for source_events, _, _ in results for event in source_events if start.isoformat() <= event["date"] <= end.isoformat()}
    success_times = [fetched for _, status, fetched in results if status["status"] == "ok"]
    return {"events": sorted(events.values(), key=lambda e: (e["date"], e["startAt"] or "", e["title"])),
            "sources": [status for _, status, _ in results],
            "fetchedAt": min(success_times) if success_times else min(fetched for _, _, fetched in results), "timezone": "Asia/Seoul"}
