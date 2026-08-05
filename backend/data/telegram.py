"""텔레그램 발송 — 야간 알림 스크립트와 장중 알림 엔드포인트가 함께 쓴다.

TELEGRAM_CHAT_ID는 쉼표로 여러 명을 넣을 수 있다. 한 명이 실패해도(차단·오타)
나머지에게는 계속 보낸다 — 한 사람 때문에 전체 알림이 멈추면 안 된다.
"""

import json
import os
import urllib.parse
import urllib.request


def _safe_print(msg: str) -> None:
    """로그 출력이 알림 자체를 죽이지 않게. 이모지를 못 찍는 콘솔이 있다."""
    try:
        print(msg)
    except UnicodeEncodeError:
        print(msg.encode("ascii", "replace").decode())


def send_telegram(text: str) -> bool:
    """등록된 모든 수신자에게 발송. 한 명이라도 성공하면 True."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chats = [c.strip() for c in os.environ.get("TELEGRAM_CHAT_ID", "").split(",") if c.strip()]
    if not token or not chats:
        # 콘솔 인코딩이 이모지를 못 받는 환경(윈도우 cp949)에서 죽지 않게 한다.
        _safe_print("[드라이런] 텔레그램 미설정. 보낼 내용:\n" + text)
        return False

    sent = 0
    for chat in chats:
        body = urllib.parse.urlencode({
            "chat_id": chat, "text": text, "disable_web_page_preview": "true",
        }).encode()
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage", data=body, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                ok = json.loads(r.read()).get("ok", False)
            _safe_print(f"  → {chat}: {'성공' if ok else '실패'}")
            sent += ok
        except Exception as e:
            _safe_print(f"  → {chat}: 실패 ({e})")
    return sent > 0
