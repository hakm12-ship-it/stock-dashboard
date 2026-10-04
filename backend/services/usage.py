"""Small, process-local aggregate counters. Never stores URLs, query values or account data."""
from collections import deque
from datetime import datetime, timedelta, timezone
import threading

KST = timezone(timedelta(hours=9))
_guard = threading.Lock()
_day = ""
_requests = _http_errors = _cache_hits = _cache_loads = _cache_errors = 0
_recent = deque(maxlen=5)
STARTED_AT = datetime.now(KST).isoformat()

# Only known public routes count; diagnostic reads and private operations do not.
PUBLIC_ROUTES = frozenset({
    "/api/prices", "/api/watchlist", "/api/quotes", "/api/index", "/api/indicators",
    "/api/signal", "/api/signal-history", "/api/forecast", "/api/fx", "/api/fx-history",
    "/api/macro", "/api/market-top", "/api/groups", "/api/group-stocks", "/api/news",
    "/api/calendar", "/api/public-briefing", "/api/daily-report", "/api/ai-briefing",
    "/api/related-insight", "/api/portfolio-review", "/api/valuation", "/api/profile",
    "/api/forward-pe", "/api/trend", "/api/target", "/api/symbols",
    "/api/night-price", "/api/night-candles", "/api/night-gap-history", "/api/synth-price",
    "/api/fx-attribution", "/api/leverage-decay", "/api/peers", "/api/deal-trend",
})

def _today():
    return datetime.now(KST).date().isoformat()

def _roll():
    global _day, _requests, _http_errors, _cache_hits, _cache_loads, _cache_errors
    today = _today()
    if _day != today:
        _day = today
        _requests = _http_errors = _cache_hits = _cache_loads = _cache_errors = 0
        _recent.clear()

def record_request(path: str, status: int):
    if path not in PUBLIC_ROUTES:
        return
    global _requests, _http_errors
    with _guard:
        _roll()
        _requests += 1
        if status >= 400:
            _http_errors += 1
            _recent.append({"path": path, "status": status, "at": datetime.now(KST).isoformat()})

def record_cache(outcome: str):
    global _cache_hits, _cache_loads, _cache_errors
    with _guard:
        _roll()
        if outcome == "hit": _cache_hits += 1
        elif outcome == "load": _cache_loads += 1
        elif outcome == "error": _cache_errors += 1

def snapshot():
    with _guard:
        _roll()
        total = _cache_hits + _cache_loads
        return {"date": _day, "startedAt": STARTED_AT, "requests": _requests,
                "httpErrors": _http_errors, "cacheHits": _cache_hits, "cacheLoads": _cache_loads,
                "cacheErrors": _cache_errors, "cacheHitRate": round(_cache_hits / total * 100, 1) if total else None,
                "recentErrors": list(_recent)}
