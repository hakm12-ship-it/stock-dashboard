"""야간 갭이 크게 벌어지면 텔레그램으로 알린다 (GitHub Actions에서 주기 실행).

배포된 API를 호출하므로 별도 계산이 없고, 겸사겸사 Render 인스턴스를 깨워둔다.

환경변수:
    TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID  — 없으면 전송 없이 출력만(드라이런)
    ALERT_THRESHOLD  기본 3.0  — |갭|이 이 값을 넘으면 알림
    ALERT_STEP       기본 1.5  — 이미 알린 뒤 추가로 이만큼 더 벌어져야 재알림
    ALERT_STATE      기본 alert_state.json  — 중복 알림 방지용 상태 파일
    API_BASE         기본 배포 URL

중복 방지: GitHub Actions는 실행마다 초기화되므로 상태 파일을 캐시로 넘긴다.
같은 날 이미 알린 종목은, 갭이 ALERT_STEP만큼 더 벌어졌을 때만 다시 알린다.
"""

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))

API_BASE = os.environ.get("API_BASE", "https://stock-insight-zws6.onrender.com")
STATE_PATH = os.environ.get("ALERT_STATE", "alert_state.json")
THRESHOLD = float(os.environ.get("ALERT_THRESHOLD", "3.0"))
STEP = float(os.environ.get("ALERT_STEP", "1.5"))

WATCH = [("005930", "삼성전자"), ("000660", "SK하이닉스")]


def _get(path: str, **params):
    url = f"{API_BASE}{path}?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.loads(r.read())


def load_state() -> dict:
    try:
        with open(STATE_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(state: dict) -> None:
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)


def send(text: str) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat:
        print("[드라이런] 전송 안 함 (토큰 없음). 보낼 내용:")
        print(text)
        return False
    body = urllib.parse.urlencode({
        "chat_id": chat, "text": text, "disable_web_page_preview": "true",
    }).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage", data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read()).get("ok", False)


def should_alert(gap: float, prev: dict | None, today: str) -> bool:
    if abs(gap) < THRESHOLD:
        return False
    if not prev or prev.get("date") != today:
        return True  # 오늘 첫 알림

    last = prev.get("gap", 0.0)
    if (gap > 0) != (last > 0):
        return True  # 방향이 뒤집혔다 — 되돌림이 아니라 급반전이라 알린다
    # 같은 방향이면 더 벌어졌을 때만 (조금 되돌아오는 건 알리지 않음)
    return abs(gap) - abs(last) >= STEP


def main() -> None:
    today = datetime.now(KST).strftime("%Y-%m-%d")
    state = load_state()
    lines = []
    force = os.environ.get("ALERT_FORCE") == "true"

    for ticker, name in WATCH:
        try:
            d = _get("/api/night-price", ticker=ticker)
        except Exception as e:
            print(f"{name}: 조회 실패 {e}")
            continue
        if not d.get("available"):
            continue
        gap = d["gapPct"]
        print(f"{name}: 야간 갭 {gap:+.2f}% (임계 ±{THRESHOLD}%)")
        if force or should_alert(gap, state.get(ticker), today):
            arrow = "▲" if gap > 0 else "▼"
            lines.append(
                f"{arrow} {name} 야간 {gap:+.2f}%\n"
                f"   KRX종가 {d['krxClose']:,.0f}원 → 야간 {d['krw']:,.0f}원"
            )
            state[ticker] = {"date": today, "gap": gap}

    if lines:
        text = (
            "🌙 야간 시세 알림\n\n" + "\n\n".join(lines)
            + "\n\nperp 기준 참고 정보이고 투자 권유가 아니에요."
        )
        print("전송:", send(text))
        save_state(state)
    else:
        print("알릴 것 없음")
        save_state(state)


if __name__ == "__main__":
    main()
