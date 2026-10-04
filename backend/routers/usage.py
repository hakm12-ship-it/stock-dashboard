from fastapi import APIRouter, Response
from services import public_ai, usage

router = APIRouter()

@router.get("/api/usage-status")
def usage_status(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return {"scope": "server_process", "timezone": "Asia/Seoul",
            "api": usage.snapshot(), "ai": public_ai.usage_snapshot()}
