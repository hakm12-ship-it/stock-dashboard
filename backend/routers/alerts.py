"""장중 급변 알림 — 외부 스케줄러(cron-job.org)가 1분마다 호출한다.

GitHub Actions의 schedule은 이 저장소에서 수 시간씩 밀리는 게 관측돼(2026-08),
장중 급변 알림에는 못 쓴다. 그래서 알림 판정을 서버 엔드포인트로 옮기고
분 단위로 정확한 외부 스케줄러가 두드리게 했다.

상태(어디까지 알렸는지)는 프로세스 메모리에 둔다. Render가 재시작하면
초기화되는데, 그때는 한 번 더 알림이 갈 뿐이라 감수한다 — 파일/DB를 쓰면
무료 플랜에서 디스크가 날아가는 문제가 또 생긴다.
"""

import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter

from analysis.market_alerts import (
    circuit_message,
    circuit_step,
    sidecar_hit,
    sidecar_message,
    stock_message,
    stock_step,
)
from data.naver_index import realtime_index, realtime_quote
from data.telegram import send_telegram

router = APIRouter()

KST = timezone(timedelta(hours=9))
WATCH = [("005930", "삼성전자"), ("000660", "SK하이닉스")]

# 오늘 어디까지 알렸는지. {"날짜": "...", "stock:005930": 2, "sidecar": 1, "circuit": 0}
_sent: dict = {}


def _reset_if_new_day(today: str) -> None:
    if _sent.get("date") != today:
        _sent.clear()
        _sent["date"] = today


def _krx_open(now: datetime) -> bool:
    """정규장 09:00~15:30 (주말 제외). 공휴일은 시세가 안 움직여 자연히 걸러진다."""
    if now.weekday() >= 5:
        return False
    minutes = now.hour * 60 + now.minute
    return 9 * 60 <= minutes <= 15 * 60 + 30


@router.get("/api/market-alert-check")
def api_market_alert_check(force: bool = False):
    """급변 조건을 확인하고 넘으면 텔레그램 발송. 외부 스케줄러 전용."""
    now = datetime.now(KST)
    today = now.strftime("%Y-%m-%d")
    _reset_if_new_day(today)

    if not force and not _krx_open(now):
        return {"checked": False, "reason": "정규장 시간 아님", "at": now.strftime("%H:%M")}

    lines: list[str] = []
    seen: dict = {}

    # 개별 종목 — 5% 계단을 새로 넘었을 때만
    for code, name in WATCH:
        try:
            q = realtime_quote(code)
        except Exception as e:
            seen[name] = f"조회실패: {e}"
            continue
        pct = q["changePct"]
        step = stock_step(pct)
        seen[name] = pct
        key = f"stock:{code}"
        if step != 0 and abs(step) > abs(_sent.get(key, 0)):
            lines.append(stock_message(name, q["last"], pct, step))
            _sent[key] = step

    # 사이드카 — 코스피200 선물
    try:
        fut = realtime_index("FUT")
        seen["선물"] = fut["changePct"]
        hit = sidecar_hit(fut["changePct"])
        if hit != 0 and _sent.get("sidecar") != hit:
            lines.append(sidecar_message(hit, fut["changePct"]))
            _sent["sidecar"] = hit
    except Exception as e:
        seen["선물"] = f"조회실패: {e}"

    # 서킷브레이커 — 코스피 지수
    try:
        kospi = realtime_index("KOSPI")
        seen["코스피"] = kospi["changePct"]
        step = circuit_step(kospi["changePct"])
        if step > _sent.get("circuit", 0):
            lines.append(circuit_message(step, kospi["changePct"]))
            _sent["circuit"] = step
    except Exception as e:
        seen["코스피"] = f"조회실패: {e}"

    sent = False
    if lines:
        text = "📈 장중 알림\n\n" + "\n\n".join(lines) + "\n\n참고용이고 투자 권유가 아니에요."
        sent = send_telegram(text)

    return {
        "checked": True,
        "at": now.strftime("%H:%M"),
        "quotes": seen,
        "alerts": len(lines),
        "sent": sent,
    }


@router.get("/api/market-alert-config")
def api_market_alert_config():
    """알림이 켜져 있는지 확인용 (토큰 값은 노출하지 않는다)."""
    chats = [c for c in os.environ.get("TELEGRAM_CHAT_ID", "").split(",") if c.strip()]
    return {
        "telegramReady": bool(os.environ.get("TELEGRAM_BOT_TOKEN")) and bool(chats),
        "recipients": len(chats),
        "sentToday": {k: v for k, v in _sent.items() if k != "date"},
    }
