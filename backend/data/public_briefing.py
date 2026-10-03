"""On-demand public RSS briefings. Never invokes AI or notification builders.

Only the current Korean-time slot can create a snapshot. Past slots are read
from the bounded process cache, so newly fetched news cannot impersonate an old
briefing. Process restarts may remove archives; missing archives stay explicit.
"""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import threading
import time

from data.market_digest import _FEEDS, _deduplicate, _fetch_feed, _select

KST = timezone(timedelta(hours=9))
SLOTS = {"morning": (7, "아침"), "noon": (12, "점심"), "evening": (18, "저녁")}
ARCHIVE_DAYS = 7
MAX_ITEMS = 7
MIN_ITEMS = 5
MAX_CACHE_ENTRIES = ARCHIVE_DAYS * len(SLOTS)
FAILURE_COOLDOWN = 10 * 60
_cache: dict[tuple[str, str], tuple[float, dict]] = {}
_guard = threading.Lock()
_generation = threading.Lock()


def _current_slot(now: datetime) -> str | None:
    return next((slot for slot in reversed(SLOTS) if now.hour >= SLOTS[slot][0]), None)


def _start(slot: str, now: datetime) -> datetime:
    if slot == "morning":
        return (now - timedelta(days=1)).replace(hour=18, minute=0, second=0, microsecond=0)
    return now.replace(hour=7 if slot == "noon" else 12, minute=0, second=0, microsecond=0)


def _empty(day: date, slot: str, status: str, message: str, *, retry_after: int = 0) -> dict:
    hour, label = SLOTS[slot]
    return {
        "date": day.isoformat(), "slot": slot, "label": label, "timezone": "Asia/Seoul",
        "scheduledAt": datetime.combine(day, datetime.min.time(), KST).replace(hour=hour).isoformat(),
        "status": status, "available": False, "message": message,
        "generatedAt": None, "windowStart": None, "windowEnd": None,
        "backfillStart": None, "backfillCount": 0, "items": [], "sources": [],
        "retryAfter": retry_after, "mode": "rss_headlines",
    }


def _collect_sources() -> tuple[list[dict], list[dict]]:
    articles: list[dict] = []
    states: dict[str, list[bool]] = {}
    # At most three upstream sockets, shared by all visitors through _generation.
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [(feed, pool.submit(_fetch_feed, feed)) for feed in _FEEDS]
        for feed, future in futures:
            try:
                articles.extend(future.result())
                states.setdefault(feed[0], []).append(True)
            except Exception:
                states.setdefault(feed[0], []).append(False)
    sources = [{
        "name": name, "status": "ok" if all(values) else "partial" if any(values) else "error",
    } for name, values in states.items()]
    return articles, sources


def _build(day: date, slot: str, now: datetime) -> dict:
    start = _start(slot, now)
    articles, sources = _collect_sources()
    recent = _deduplicate([
        item for item in articles
        if now - timedelta(hours=24) <= datetime.fromisoformat(item["publishedAt"]) <= now
    ])
    selected = _select([item for item in recent if datetime.fromisoformat(item["publishedAt"]) >= start], MAX_ITEMS)
    if len(selected) < MIN_ITEMS:
        selected = _select([item for item in recent if datetime.fromisoformat(item["publishedAt"]) < start], MIN_ITEMS, selected)
    items = [{
        "id": item["id"], "title": item["title"], "source": item["source"],
        "url": item["url"], "publishedAt": item["publishedAt"],
        "previousWindow": datetime.fromisoformat(item["publishedAt"]) < start,
    } for item in selected]
    backfill = sum(item["previousWindow"] for item in items)
    result = _empty(day, slot, "ready" if items else "unavailable",
                    "기사 제목을 모았습니다. 자세한 내용은 원문에서 확인하세요." if items
                    else "최근 24시간 내 발행시각이 확인된 기사를 확보하지 못했어요.",
                    retry_after=0 if items else FAILURE_COOLDOWN)
    result.update(
        available=bool(items), generatedAt=now.isoformat(), windowStart=start.isoformat(),
        windowEnd=now.isoformat(), backfillStart=(now - timedelta(hours=24)).isoformat() if backfill else None,
        backfillCount=backfill, items=items, sources=sources,
    )
    return result


def get_public_briefing(slot: str, day: date | None = None, *, now: datetime | None = None) -> dict:
    """At most one successful RSS collection per current date/slot, no paid IO."""
    if slot not in SLOTS:
        raise ValueError("지원하지 않는 브리핑 시간대입니다.")
    current = now or datetime.now(KST)
    if current.tzinfo is None or current.utcoffset() is None:
        raise ValueError("timezone-aware clock required")
    current = current.astimezone(KST)
    day = day or current.date()
    if not current.date() - timedelta(days=ARCHIVE_DAYS - 1) <= day <= current.date():
        raise ValueError("오늘부터 최근 7일의 브리핑만 조회할 수 있습니다.")
    hour = SLOTS[slot][0]
    if day == current.date() and current.hour < hour:
        return _empty(day, slot, "not_started", f"{SLOTS[slot][1]} 브리핑은 한국시간 {hour:02d}:00 이후 확인할 수 있어요.")
    key = (day.isoformat(), slot)
    clock = time.monotonic()
    with _guard:
        cutoff = (current.date() - timedelta(days=ARCHIVE_DAYS - 1)).isoformat()
        for old in [old for old in _cache if old[0] < cutoff]:
            _cache.pop(old, None)
        cached = _cache.get(key)
        if cached and (cached[1]["available"] or cached[0] > clock):
            result = deepcopy(cached[1])
            if not result["available"]:
                result["retryAfter"] = max(1, int(cached[0] - clock))
            return result
    if day != current.date() or slot != _current_slot(current):
        return _empty(day, slot, "archive_unavailable", "이 시간대에 저장된 브리핑이 없어요. 현재 시간대의 브리핑을 확인해 주세요.")
    if not _generation.acquire(blocking=False):
        return _empty(day, slot, "building", "브리핑을 모으는 중이에요. 잠시 후 다시 확인해 주세요.", retry_after=5)
    try:
        # A competing request may have completed between the first lookup and
        # acquiring the generation lock. Check again before any upstream IO.
        with _guard:
            cached = _cache.get(key)
            if cached and (cached[1]["available"] or cached[0] > time.monotonic()):
                return deepcopy(cached[1])
        try:
            result = _build(day, slot, current)
        except Exception:
            result = _empty(day, slot, "unavailable", "기사 출처를 확인하지 못했어요. 잠시 후 다시 조회해 주세요.",
                            retry_after=FAILURE_COOLDOWN)
        with _guard:
            while len(_cache) >= MAX_CACHE_ENTRIES:
                _cache.pop(next(iter(_cache)))
            _cache[key] = (0 if result["available"] else time.monotonic() + FAILURE_COOLDOWN, deepcopy(result))
        return result
    finally:
        _generation.release()
