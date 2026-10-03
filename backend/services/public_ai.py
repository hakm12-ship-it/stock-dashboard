"""Bounded process-wide budget for the public, optional AI panels.

Successful results survive small market-price changes because callers use stable
server-defined identities. Failures are cached too; a quota response pauses all
public AI panels. No request can override these limits through query parameters.
The budget is deliberately in-process (one Uvicorn worker in this deployment).
"""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import math
import os
import threading
import time
from urllib.error import HTTPError

KST = timezone(timedelta(hours=9))
DEFAULT_DAILY_LIMIT = 20
MAX_CONCURRENT = 1
FAILURE_COOLDOWN = 120
QUOTA_COOLDOWN = 15 * 60
MAX_CACHE_ENTRIES = 256
_guard = threading.Lock()
_cache: dict[tuple[str, str], tuple[float, object]] = {}
_failures: dict[tuple[str, str], tuple[float, str]] = {}
_inflight: set[tuple[str, str]] = set()
_day = ""
_attempts = 0
_cooldown_until = 0.0


class AIUnavailable(RuntimeError):
    def __init__(self, reason: str, retry_after: int = 0):
        self.reason = reason
        self.retry_after = max(0, retry_after)
        super().__init__(reason)


def _today() -> str:
    return datetime.now(KST).date().isoformat()


def _daily_limit() -> int:
    try:
        return max(0, min(100, int(os.environ.get("PUBLIC_AI_DAILY_LIMIT", DEFAULT_DAILY_LIMIT))))
    except (TypeError, ValueError):
        return DEFAULT_DAILY_LIMIT


def _trim(now: float) -> None:
    for key, (expires, _) in list(_cache.items()):
        if expires <= now:
            _cache.pop(key, None)
    for key, (expires, _) in list(_failures.items()):
        if expires <= now:
            _failures.pop(key, None)
    for store in (_cache, _failures):
        while len(store) >= MAX_CACHE_ENTRIES:
            store.pop(next(iter(store)))


def cached(kind: str, identity: str):
    """Read a copy without loading prices or contacting the model."""
    with _guard:
        hit = _cache.get((kind, identity))
        if hit and hit[0] > time.monotonic():
            return deepcopy(hit[1])
    return None


def _check_available(key: tuple[str, str], now: float) -> None:
    global _day, _attempts
    if not os.environ.get("GEMINI_API_KEY", "").strip():
        raise AIUnavailable("not_configured")
    failure = _failures.get(key)
    if failure and failure[0] > now:
        raise AIUnavailable(failure[1], math.ceil(failure[0] - now))
    if _cooldown_until > now:
        raise AIUnavailable("quota_cooldown", math.ceil(_cooldown_until - now))
    today = _today()
    if _day != today:
        _day, _attempts = today, 0
    if _attempts >= _daily_limit():
        raise AIUnavailable("daily_limit")
    if key in _inflight or len(_inflight) >= MAX_CONCURRENT:
        raise AIUnavailable("busy", 10)


def ensure_available(kind: str, identity: str) -> None:
    """Avoid expensive supporting data loads when AI is already paused."""
    with _guard:
        _check_available((kind, identity), time.monotonic())


def generate(kind: str, identity: str, create, *, ttl: int):
    """Generate at most once per identity/TTL under one shared daily budget."""
    global _day, _attempts, _cooldown_until
    key = (kind, identity)
    with _guard:
        now = time.monotonic()
        _trim(now)
        hit = _cache.get(key)
        if hit:
            return deepcopy(hit[1])
        _check_available(key, now)
        _inflight.add(key)
        _attempts += 1  # Reserve before IO, including failures/timeouts.
    try:
        result = create()
    except Exception as error:
        cooldown = FAILURE_COOLDOWN
        reason = "temporarily_unavailable"
        quota_error = isinstance(error, HTTPError) and error.code in {429, 401, 403}
        if quota_error:
            reason, cooldown = "quota_cooldown", QUOTA_COOLDOWN
            try:
                cooldown = max(cooldown, min(3600, int(error.headers.get("Retry-After", "0"))))
            except (ValueError, TypeError, AttributeError):
                pass
        with _guard:
            until = time.monotonic() + cooldown
            _failures[key] = (until, reason)
            if quota_error:
                _cooldown_until = max(_cooldown_until, until)
        raise AIUnavailable(reason, cooldown) from None
    else:
        with _guard:
            _cache[key] = (time.monotonic() + ttl, deepcopy(result))
        return deepcopy(result)
    finally:
        with _guard:
            _inflight.discard(key)
