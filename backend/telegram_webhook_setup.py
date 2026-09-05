"""텔레그램 공지 웹훅 등록 도우미.

Render 배포와 환경변수 설정이 끝난 뒤 한 번만 실행한다.

    $env:TELEGRAM_BOT_TOKEN = "..."
    $env:TELEGRAM_WEBHOOK_SECRET = "충분히-긴-무작위-문자열"
    $env:APP_BASE_URL = "https://stock-insight-xxxx.onrender.com"
    python telegram_webhook_setup.py

봇 토큰은 명령줄 인수로 주지 않는다. PowerShell 기록에 남기지 않기 위해서다.
"""

import json
import os
import urllib.parse
import urllib.request

from dotenv import load_dotenv

load_dotenv()

token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
secret = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "").strip()
base_url = os.environ.get("APP_BASE_URL", "").strip().rstrip("/")

if not token or not secret or not base_url:
    raise SystemExit("TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, APP_BASE_URL를 모두 설정하세요.")
if not base_url.startswith("https://"):
    raise SystemExit("APP_BASE_URL은 HTTPS 공개 주소여야 합니다.")

payload = urllib.parse.urlencode({
    "url": base_url + "/api/telegram/webhook",
    "secret_token": secret,
    # 일반 그룹 대화를 받지 않고 1:1 메시지만 처리한다.
    "allowed_updates": json.dumps(["message"]),
}).encode()
request = urllib.request.Request(
    f"https://api.telegram.org/bot{token}/setWebhook", data=payload, method="POST")

with urllib.request.urlopen(request, timeout=30) as response:
    result = json.loads(response.read())
if not result.get("ok"):
    raise SystemExit(f"웹훅 등록 실패: {result}")

print("웹훅 등록 완료:", base_url + "/api/telegram/webhook")
print("이제 봇과의 1:1 대화에서 /announce 공지 내용을 보내세요.")
