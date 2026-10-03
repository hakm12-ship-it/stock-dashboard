"""Public, read-only RSS snapshots; no scheduler, AI, or Telegram access."""

from datetime import date as Date
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Response

from data.public_briefing import get_public_briefing

router = APIRouter()


@router.get("/api/public-briefing")
def api_public_briefing(response: Response, slot: Literal["morning", "noon", "evening"] = "morning",
                        day: Date | None = Query(default=None, alias="date")):
    try:
        result = get_public_briefing(slot, day)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from None
    response.headers["Cache-Control"] = "public, max-age=60" if result["available"] else "no-store"
    return result
