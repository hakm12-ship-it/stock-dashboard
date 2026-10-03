"""Opt-in in-process notification polling for an already running web service.

This does not keep a sleeping/free service awake. Enable only after arranging an
always-running service and durable NOTIFICATION_STATE_PATH. Delivery deduplication
across processes/restarts belongs to the notification service's SQLite ledger.
"""

from __future__ import annotations

from datetime import datetime, timezone
import logging
import os
import threading
import time

from services import notifications


logger = logging.getLogger(__name__)
POLL_SECONDS = 5 * 60
_LOCK = threading.Lock()
_thread: threading.Thread | None = None
_stop: threading.Event | None = None
_last_check_at: str | None = None
_last_outcome: str | None = None


def _enabled() -> bool:
    return os.environ.get("NOTIFICATION_INTERNAL_SCHEDULER_ENABLED", "").strip().lower() == "true"


def scheduler_status() -> dict:
    """Operational status without tokens, recipient identifiers, or disk paths."""
    with _LOCK:
        return {
            "enabled": _enabled(),
            "running": _thread is not None and _thread.is_alive(),
            "pollEverySeconds": POLL_SECONDS,
            "lastCheckAt": _last_check_at,
            "lastOutcome": _last_outcome,
        }


def _seconds_to_next_tick() -> float:
    # UTC and KST both align to these five-minute boundaries. Recalculate after
    # each completed job, so slow requests skip missed ticks rather than drift.
    return POLL_SECONDS - (time.time() % POLL_SECONDS)


def _run(stop: threading.Event) -> None:
    global _last_check_at, _last_outcome
    while not stop.is_set():
        outcome = "disabled"
        try:
            if _enabled():
                if notifications.notification_status().get("ready"):
                    result = notifications.check_notifications(dry_run=False)
                    outcome = "checked" if result.get("checked") else "configuration_required"
                else:
                    outcome = "configuration_required"
        except Exception as exc:
            # Provider exceptions may contain private URLs. Report the class only.
            logger.warning("Internal notification check failed (%s)", type(exc).__name__)
            outcome = "error"
        with _LOCK:
            _last_check_at = datetime.now(timezone.utc).isoformat()
            _last_outcome = outcome
        # No overlap or catch-up bursts. Wake at :00/:05/... rather than five
        # minutes after a slow job, so scheduled market releases stay on time.
        if stop.wait(_seconds_to_next_tick()):
            break


def start_scheduler() -> bool:
    """Start at most one worker per process; off by default, caller never blocks."""
    global _thread, _stop
    if not _enabled():
        return False
    with _LOCK:
        if _thread is not None and _thread.is_alive():
            return False
        _stop = threading.Event()
        _thread = threading.Thread(target=_run, args=(_stop,), name="notification-scheduler", daemon=True)
        _thread.start()
        return True


def stop_scheduler(timeout: float = 2) -> None:
    """Request shutdown and wait briefly; never replace a still-running worker."""
    with _LOCK:
        thread, stop = _thread, _stop
        if stop is not None:
            stop.set()
    if thread is not None and thread is not threading.current_thread():
        thread.join(timeout=max(0, timeout))
