"""내 텔레그램 chat_id 찾기 + 알림 전송 테스트.

토큰을 어디에도 저장하지 않는다. 실행할 때 환경변수로만 넘긴다.

사용법 (PowerShell):
    $env:TELEGRAM_BOT_TOKEN = "봇토큰"
    python telegram_chat_id.py

    # chat_id까지 알아낸 뒤 실제 전송까지 테스트하려면
    $env:TELEGRAM_CHAT_ID = "찾은숫자"
    python telegram_chat_id.py --test

미리 봇에게 아무 메시지나 한 번 보내둬야 getUpdates에 대화가 잡힌다.
"""

import json
import os
import sys
import urllib.parse
import urllib.request

TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
API = "https://api.telegram.org/bot{}/{}"


def call(method: str, **params):
    url = API.format(TOKEN, method)
    if params:
        url += "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read())


def main() -> None:
    if not TOKEN:
        print("TELEGRAM_BOT_TOKEN 환경변수가 없어요.")
        print('PowerShell:  $env:TELEGRAM_BOT_TOKEN = "봇토큰"')
        sys.exit(1)

    me = call("getMe")
    if not me.get("ok"):
        print("토큰이 잘못된 것 같아요:", me)
        sys.exit(1)
    print(f"봇 확인: @{me['result']['username']}")

    if "--test" in sys.argv:
        chat = os.environ.get("TELEGRAM_CHAT_ID")
        if not chat:
            print("TELEGRAM_CHAT_ID 환경변수가 없어요.")
            sys.exit(1)
        body = urllib.parse.urlencode(
            {"chat_id": chat, "text": "🌙 스톡 인사이트 알림 테스트입니다."}
        ).encode()
        req = urllib.request.Request(API.format(TOKEN, "sendMessage"), data=body, method="POST")
        with urllib.request.urlopen(req, timeout=30) as r:
            res = json.loads(r.read())
        print("전송 성공 — 텔레그램을 확인해보세요." if res.get("ok") else f"전송 실패: {res}")
        return

    upd = call("getUpdates")
    chats = {}
    for u in upd.get("result", []):
        msg = u.get("message") or u.get("channel_post") or {}
        c = msg.get("chat")
        if c:
            chats[c["id"]] = c

    if not chats:
        print()
        print("대화가 안 잡혀요. 보통 이 두 가지 중 하나예요:")
        print("  1) 봇에게 아직 말을 안 걸었다 → 텔레그램에서 봇 찾아 아무 메시지나 전송 후 재실행")
        print("  2) 메시지가 너무 오래됐다(24시간 초과) → 다시 한 번 보내고 재실행")
        return

    print("\n찾은 대화:")
    for cid, c in chats.items():
        name = c.get("title") or " ".join(
            filter(None, [c.get("first_name"), c.get("last_name")])
        ) or c.get("username", "")
        print(f"  chat_id = {cid}   ({c.get('type')}, {name})")
    print("\n이 숫자를 GitHub Secrets의 TELEGRAM_CHAT_ID에 넣으세요.")


if __name__ == "__main__":
    main()
