"""Public event calendar plus authenticated scheduled notification endpoints."""

from datetime import date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response

from security import require_alert_key
from services.notifications import KST, build_digest, check_notifications, get_calendar, notification_status

router = APIRouter()


@router.get("/api/calendar")
def api_calendar(start: date | None = None, end: date | None = None):
    first = start or datetime.now(KST).date()
    last = end or first + timedelta(days=30)
    if last < first or (last - first).days >= 93:
        raise HTTPException(status_code=422, detail="조회 기간은 시작일부터 최대 93일입니다.")
    return get_calendar(first, last)


@router.get("/api/calendar/notification-status")
def api_notification_status(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return notification_status()


@router.get("/api/calendar/briefing-preview", dependencies=[Depends(require_alert_key)])
def api_briefing_preview(response: Response, slot: Literal["morning", "noon", "evening"] = "morning"):
    response.headers["Cache-Control"] = "no-store"
    return build_digest(slot)


@router.post("/api/calendar/notification-check", dependencies=[Depends(require_alert_key)])
def api_notification_check(response: Response, dry_run: bool = True):
    response.headers["Cache-Control"] = "no-store"
    return check_notifications(dry_run=dry_run)
