"""Access checks for scheduler endpoints that can send external notifications."""
import hmac
import os

from fastapi import HTTPException, Request


def require_alert_key(request: Request) -> None:
    expected = os.environ.get("ALERT_CHECK_KEY", "").strip() or os.environ.get("ADMIN_KEY", "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="알림 관리자 인증 키가 설정되지 않았습니다.")
    provided = request.headers.get("authorization", "")
    if not provided.startswith("Bearer ") or not hmac.compare_digest(provided[7:], expected):
        raise HTTPException(status_code=401, detail="관리자 인증이 필요합니다.", headers={"WWW-Authenticate": "Bearer"})


def require_admin_key(request: Request) -> None:
    expected = os.environ.get("ADMIN_KEY", "").strip()
    provided = request.headers.get("authorization", "")
    if not expected or not provided.startswith("Bearer ") or not hmac.compare_digest(provided[7:], expected):
        raise HTTPException(status_code=401, detail="관리자 인증이 필요합니다.")
