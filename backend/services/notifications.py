"""KST calendar reminders and market briefings with durable, at-most-once delivery.

Claims are committed before Telegram is contacted. A timeout, process crash, or
unsuccessful response is deliberately never retried automatically: Telegram has
no idempotency key, so retrying could duplicate a message that was delivered.
NOTIFICATION_STATE_PATH must point to an explicitly provisioned persistent file.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import sqlite3
import urllib.parse
import urllib.request
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Literal

KST = timezone(timedelta(hours=9))
Slot = Literal["morning", "noon", "evening"]
SLOTS: dict[str, int] = {"morning": 7, "noon": 12, "evening": 18}
GRACE = timedelta(minutes=10)
MAX_MESSAGE_UNITS = 3900
logger = logging.getLogger(__name__)


def get_calendar(start: date, end: date) -> dict:
    from data.economic_calendar import get_calendar as fetch
    return fetch(start, end)


def build_digest(slot: Slot, now: datetime | None = None) -> dict:
    from data.market_digest import build_digest as build
    return build(slot, now=now)


def _now(now: datetime | None = None) -> datetime:
    value = now or datetime.now(KST)
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("A timezone-aware clock is required.")
    return value.astimezone(KST)


def _target() -> str:
    # Never fall back to TELEGRAM_CHAT_ID, which may contain private recipients.
    return (os.environ.get("TELEGRAM_BRIEFING_CHAT_ID", "").strip()
            or os.environ.get("TELEGRAM_ANNOUNCE_CHAT_ID", "").strip())


def _valid_target(target: str) -> bool:
    return bool(re.fullmatch(r"-?\d+|@[A-Za-z][A-Za-z0-9_]{4,}", target))


def _state_path() -> Path | None:
    raw = os.environ.get("NOTIFICATION_STATE_PATH", "").strip()
    if not raw or raw == ":memory:":
        return None
    path = Path(raw).expanduser()
    return path if path.is_absolute() and not path.is_dir() else None


def notification_status() -> dict:
    """Public status deliberately omits tokens, recipient IDs, and disk paths."""
    enabled = os.environ.get("NOTIFICATIONS_ENABLED", "false").strip().lower() not in {
        "0", "false", "no", "off",
    }
    requirements = {
        "telegramToken": bool(os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()),
        "destination": _valid_target(_target()),
        "persistentState": _state_path() is not None,
        "schedulerAuth": bool(os.environ.get("ALERT_CHECK_KEY", "").strip()
                              or os.environ.get("ADMIN_KEY", "").strip()),
    }
    configured = all(requirements.values())
    from services.scheduler import scheduler_status
    scheduler_active = (scheduler_status()["running"]
                        or os.environ.get("NOTIFICATION_SCHEDULER_ACTIVE", "").strip().lower() == "true")
    return {
        "enabled": enabled,
        "configured": configured,
        "ready": enabled and configured,
        "status": "disabled" if not enabled else "ready" if configured else "configuration_required",
        "requirements": requirements,
        "timezone": "Asia/Seoul",
        "times": ["07:00", "12:00", "18:00"],
        "schedulerActive": scheduler_active,
        "schedule": {
            "briefings": ["07:00", "12:00", "18:00"],
            "tomorrowCalendar": "18:00",
            "eventReminderMinutes": 60,
            "pollEveryMinutes": 5,
            "graceMinutes": 10,
            "eventFilter": {"timeStatus": "confirmed", "importance": "high"},
        },
        "deliveryPolicy": "at_most_once",
        "automaticRetry": False,
        "scheduler": "registered" if scheduler_active else "external_required",
    }


def _limited(text: str) -> str:
    """Stay below Telegram's limit even when text contains emoji surrogate pairs."""
    encoded = text.encode("utf-16-le")
    if len(encoded) <= MAX_MESSAGE_UNITS * 2:
        return text
    return encoded[:(MAX_MESSAGE_UNITS - 20) * 2].decode("utf-16-le", errors="ignore") + "\n… 나머지 일정은 앱에서 확인"


def send_telegram_message(chat_id: str, text: str) -> bool:
    """Send to exactly one configured room without logging request URLs or secrets."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token or not _valid_target(chat_id):
        return False
    body = urllib.parse.urlencode({
        "chat_id": chat_id, "text": _limited(text), "disable_web_page_preview": "true",
    }).encode()
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage", data=body, method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return bool(json.loads(response.read()).get("ok", False))
    except Exception as exc:  # API errors can embed the token-bearing request URL.
        logger.warning("Scheduled Telegram delivery unconfirmed (%s)", type(exc).__name__)
        return False


@dataclass(frozen=True)
class Job:
    id: str
    kind: str
    text: str
    scheduled_at: str


def _job(target: str, kind: str, identity: str, text: str, scheduled: datetime) -> Job:
    recipient = hashlib.sha256(target.encode()).hexdigest()
    key = hashlib.sha256(f"v1|{recipient}|{kind}|{identity}".encode()).hexdigest()
    return Job(key, kind, _limited(text), scheduled.isoformat())


def _event_time(event: dict) -> datetime | None:
    if event.get("timeStatus") != "confirmed" or not event.get("startAt"):
        return None
    try:
        parsed = datetime.fromisoformat(str(event["startAt"]).replace("Z", "+00:00"))
        return _now(parsed)
    except (TypeError, ValueError):
        return None


def _event_line(event: dict) -> str:
    when = _event_time(event)
    if when is None and event.get("startAt"):
        try:
            when = _now(datetime.fromisoformat(str(event["startAt"]).replace("Z", "+00:00")))
        except (ValueError, TypeError):
            pass
    clock = when.strftime("%H:%M 한국시간") if when else "시간 미정"
    if when is None and event.get("country") == "US":
        clock += f" · 미국 현지 날짜 {event.get('date', '')}"
    if event.get("timeStatus") == "tentative":
        clock = f"예상 · {clock}"
    country = "한국" if event.get("country") == "KR" else "미국"
    title = str(event.get("title", "일정"))[:300]
    return f"• {clock} · {country} · {title}"


def _plan(now: datetime, target: str) -> tuple[list[Job], list[str]]:
    jobs: list[Job] = []
    skipped: list[str] = []
    for slot, hour in SLOTS.items():
        scheduled = datetime.combine(now.date(), time(hour), tzinfo=KST)
        if not scheduled <= now < scheduled + GRACE:
            continue
        try:
            digest = build_digest(slot, now=now)
            if digest.get("available") and str(digest.get("text", "")).strip():
                jobs.append(_job(target, "briefing", f"{now.date()}|{slot}", digest["text"], scheduled))
            else:
                skipped.append(f"{slot}:data_unavailable")
        except Exception as exc:
            logger.warning("Briefing provider unavailable (%s)", type(exc).__name__)
            skipped.append(f"{slot}:data_unavailable")

    tomorrow = now.date() + timedelta(days=1)
    try:
        calendar = get_calendar(now.date(), tomorrow)
    except Exception as exc:
        logger.warning("Calendar provider unavailable (%s)", type(exc).__name__)
        return jobs, [*skipped, "calendar:data_unavailable"]
    events = calendar.get("events", [])
    usable = any(source.get("status") == "ok" for source in calendar.get("sources", []))
    evening = datetime.combine(now.date(), time(18), tzinfo=KST)
    if evening <= now < evening + GRACE:
        if usable:
            next_events = [event for event in events if event.get("date") == tomorrow.isoformat()]
            next_events.sort(key=lambda event: (event.get("startAt") or "z", str(event.get("title", ""))))
            text = f"주요 일정 미리보기 · {tomorrow:%m/%d}\n시각은 한국시간, 시간 미정인 미국 일정은 현지 날짜 기준입니다.\n"
            text += "\n".join(_event_line(event) for event in next_events) or "현재 확인된 주요 일정이 없습니다."
            if any(source.get("status") != "ok" for source in calendar.get("sources", [])):
                text += "\n일부 출처는 조회하지 못해 일정이 누락될 수 있습니다."
            jobs.append(_job(target, "tomorrow_calendar", tomorrow.isoformat(), text, evening))
        else:
            skipped.append("tomorrow_calendar:data_unavailable")
    for event in events:
        when = _event_time(event)
        if event.get("importance") != "high" or when is None:
            continue
        scheduled = when - timedelta(hours=1)
        if not scheduled <= now < scheduled + GRACE:
            continue
        text = f"주요 일정 약 1시간 전\n{_event_line(event)}\n{when:%m/%d %H:%M} 한국시간"
        if event.get("source"):
            text += f"\n출처: {str(event['source'])[:120]}"
        if str(event.get("sourceUrl", "")).startswith("https://"):
            text += f"\n{event['sourceUrl']}"
        identity = f"{event.get('id') or event.get('title')}|{when.astimezone(timezone.utc).isoformat()}"
        jobs.append(_job(target, "event_reminder", identity, text, scheduled))
    # Providers may list an event more than once; dry-run should also be unique.
    return list({job.id: job for job in jobs}.values()), skipped


@contextmanager
def _connect(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(str(path), timeout=20)
    try:
        db.execute("PRAGMA busy_timeout = 20000")
        db.execute("""CREATE TABLE IF NOT EXISTS notification_jobs (
            job_id TEXT PRIMARY KEY, kind TEXT NOT NULL, scheduled_at TEXT NOT NULL,
            claimed_at TEXT NOT NULL, status TEXT NOT NULL, completed_at TEXT
        )""")
        db.commit()
        with db:
            yield db
    finally:
        db.close()


def _claim(path: Path, job: Job, now: datetime) -> bool:
    with _connect(path) as db:
        db.execute("BEGIN IMMEDIATE")
        result = db.execute(
            "INSERT OR IGNORE INTO notification_jobs "
            "(job_id, kind, scheduled_at, claimed_at, status) VALUES (?, ?, ?, ?, 'claimed')",
            (job.id, job.kind, job.scheduled_at, now.isoformat()),
        )
        return result.rowcount == 1


def _complete(path: Path, job: Job, status: str, now: datetime) -> None:
    with _connect(path) as db:
        db.execute("UPDATE notification_jobs SET status = ?, completed_at = ? WHERE job_id = ?",
                   (status, now.isoformat(), job.id))


def check_notifications(*, dry_run: bool = True, now: datetime | None = None) -> dict:
    """Evaluate jobs; sends require explicit dry_run=False and complete configuration."""
    current = _now(now)
    status = notification_status()
    result = {
        "checked": False, "dryRun": dry_run, "at": current.isoformat(),
        "configuration": status, "jobs": [], "skipped": [],
    }
    if not dry_run and not status["ready"]:
        result["reason"] = status["status"]
        return result
    target = _target()
    jobs, skipped = _plan(current, target)
    result.update(checked=True, skipped=skipped)
    if dry_run:
        result["jobs"] = [
            {"id": job.id, "kind": job.kind, "scheduledAt": job.scheduled_at,
             "status": "preview", "text": job.text} for job in jobs
        ]
        return result
    path = _state_path()
    if path is None:  # Environment could have changed while providers ran.
        result.update(checked=False, reason="configuration_required")
        return result
    for job in jobs:
        entry = {"id": job.id, "kind": job.kind, "scheduledAt": job.scheduled_at}
        try:
            if not _claim(path, job, current):
                entry["status"] = "already_claimed"
                result["jobs"].append(entry)
                continue
        except (OSError, sqlite3.Error) as exc:
            logger.warning("Notification ledger unavailable (%s)", type(exc).__name__)
            entry["status"] = "state_unavailable"
            result["jobs"].append(entry)
            continue
        try:
            delivered = send_telegram_message(target, job.text)
        except Exception as exc:
            logger.warning("Notification delivery unconfirmed (%s)", type(exc).__name__)
            delivered = False
        entry["status"] = "sent" if delivered else "delivery_unknown"
        try:
            _complete(path, job, entry["status"], current)
        except (OSError, sqlite3.Error) as exc:
            # The durable claim remains valid even if recording the outcome fails.
            logger.warning("Notification result could not be recorded (%s)", type(exc).__name__)
            entry["status"] = "sent_state_unconfirmed" if delivered else "delivery_unknown"
        result["jobs"].append(entry)
    return result
