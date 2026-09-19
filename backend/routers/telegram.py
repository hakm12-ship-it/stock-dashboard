"""텔레그램 봇의 관리자 전용 공지 명령.

사용자가 봇과의 1:1 대화에서 ``/announce 공지 내용``을 보내면, 지정한
스톡 인사이트 그룹에만 공지한다. 그룹의 일반 대화는 읽지 않는다.

처리 결과는 관리자 1:1 대화로 되돌려 준다 — 안 그러면 명령을 보내고도
공지가 나갔는지, 설정이 빠졌는지 알 길이 없다.
"""

import hmac
import os
from collections import OrderedDict

from fastapi import APIRouter, Header, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from data.telegram import send_telegram_to

router = APIRouter()

_COMMANDS = {"/announce", "/broadcast", "/공지"}
_MAX_ANNOUNCEMENT_LENGTH = 3_500
_HEADER = "📢 스톡 인사이트 공지\n\n"

# 최근 처리한 update_id. Telegram은 웹훅 응답이 늦거나 실패하면 **같은
# 업데이트를 다시 보낸다**. 그룹 발송에 몇 초 걸리는 사이 재전송이 오면
# 같은 공지가 두 번 올라간다 — 알림 중복으로 이미 한 번 데였다.
# 재전송은 분 단위 안에 끝나므로 메모리에 최근 것만 들고 있으면 충분하다.
_seen: OrderedDict = OrderedDict()
_SEEN_MAX = 256


def _secret_ok(header: str | None) -> bool:
    """Telegram이 setWebhook 때 등록한 비밀 헤더와 일치하는지."""
    secret = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "").strip()
    return bool(secret and header and hmac.compare_digest(secret, header))


def _already_seen(update_id) -> bool:
    if update_id is None:
        return False
    if update_id in _seen:
        return True
    _seen[update_id] = True
    while len(_seen) > _SEEN_MAX:
        _seen.popitem(last=False)
    return False


def announcement_from_update(update: dict) -> str | None:
    """신뢰할 수 있는 관리자 1:1 명령에서 공지 본문만 추출한다.

    허용하지 않는 업데이트는 모두 무시한다. 명령 처리 전에 Telegram webhook
    secret도 라우트에서 검증하므로, 이 함수는 두 번째 방어선 역할을 한다.
    """
    admin_id = os.environ.get("TELEGRAM_ADMIN_USER_ID", "").strip()
    message = update.get("message")
    if not admin_id or not isinstance(message, dict):
        return None

    sender = message.get("from") or {}
    chat = message.get("chat") or {}
    if str(sender.get("id", "")) != admin_id or chat.get("type") != "private":
        return None

    text = message.get("text")
    if not isinstance(text, str):
        return None
    command, separator, body = text.strip().partition(" ")
    # 그룹에서 /announce@bot 형태로 온 명령도 안전하게 파싱하되, 위에서 이미
    # private chat만 허용했으므로 실제 공지는 관리자 1:1 대화에서만 가능하다.
    command = command.split("@", 1)[0].lower()
    if command not in _COMMANDS or not separator:
        return None

    body = body.strip()
    if not body or len(body) > _MAX_ANNOUNCEMENT_LENGTH:
        return None
    return body


def handle_update(update: dict) -> dict:
    """인증이 끝난 업데이트 하나를 처리한다. 동기 함수라 스레드풀에서 돈다.

    반환값은 Telegram에 주는 응답이다. Telegram은 내용을 보지 않고 2xx만
    확인하므로, 사람이 로그에서 읽기 좋은 정도면 된다.
    """
    if _already_seen(update.get("update_id")):
        return {"ok": True, "announcement": False, "duplicate": True}

    body = announcement_from_update(update)
    if not body:
        return {"ok": True, "announcement": False}

    # 1:1 대화라 chat.id가 곧 관리자 본인이다. 결과를 여기로 되돌려 준다.
    admin_chat = str(update["message"]["chat"].get("id", ""))
    target = os.environ.get("TELEGRAM_ANNOUNCE_CHAT_ID", "").strip()
    if not target:
        send_telegram_to(
            admin_chat,
            "⚠️ 공지를 보낼 그룹이 설정돼 있지 않아요.\n"
            "Render 환경변수 TELEGRAM_ANNOUNCE_CHAT_ID를 확인하세요.",
        )
        return {"ok": True, "announcement": False, "configured": False}

    sent = send_telegram_to(target, _HEADER + body)
    send_telegram_to(
        admin_chat,
        "✅ 공지를 그룹에 올렸어요." if sent
        else "❌ 공지 전송에 실패했어요. 봇이 그 그룹에 들어가 있는지, chat_id가 맞는지 확인하세요.",
    )
    return {"ok": True, "announcement": sent}


@router.post("/api/telegram/webhook")
async def telegram_webhook(
    request: Request,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
):
    """Telegram webhook endpoint. 올바른 비밀 헤더가 없으면 처리하지 않는다."""
    if not _secret_ok(x_telegram_bot_api_secret_token):
        raise HTTPException(status_code=403, detail="invalid webhook secret")

    try:
        update = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid Telegram update") from exc
    if not isinstance(update, dict):
        raise HTTPException(status_code=400, detail="invalid Telegram update")

    # 발송은 동기 HTTP(최대 30초)다. 이벤트 루프에서 직접 돌리면 그동안 서버
    # 전체가 멈춘다 — 1분마다 오는 알림 확인 요청까지. 스레드풀로 넘긴다.
    return await run_in_threadpool(handle_update, update)
