"""급변 알림 — 외부 스케줄러(cron-job.org)가 주기적으로 호출한다.

    /api/market-alert-check  장중: 삼성·하이닉스 5% 계단, 사이드카, 서킷
    /api/night-alert-check   야간: perp 갭이 ±3% 넘게 벌어졌을 때

GitHub Actions의 schedule은 이 저장소에서 2~9시간씩 밀리는 게 관측돼(2026-08)
알림에는 못 쓴다. 그래서 판정을 서버 엔드포인트로 옮기고 분 단위로 정확한
외부 스케줄러가 두드리게 했다 — 야간 알림도 같은 이유로 여기로 옮겨왔다.

상태(어디까지 알렸는지)는 프로세스 메모리에 둔다. Render가 재시작하면
초기화되는데, 그때는 한 번 더 알림이 갈 뿐이라 감수한다 — 파일/DB를 쓰면
무료 플랜에서 디스크가 날아가는 문제가 또 생긴다.
"""

import os
from datetime import datetime, timedelta, timezone
from datetime import time as dt_time

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from analysis.market_alerts import (
    circuit_message,
    circuit_step,
    sidecar_hit,
    sidecar_message,
    stock_message,
    stock_step,
)
from data.naver_index import realtime_index, realtime_quote
from data.kakao import REDIRECT_PATH, authorize_url, exchange_code
from data.kakao import is_configured as kakao_configured
from data.kakao import last_error as kakao_last_error
from data.kakao import refresh_token_days_left, send_kakao
from data.notify import APP_URL, notify
from routers.night import api_night_price, night_gap_extreme

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
def api_market_alert_check(force: bool = False, test: bool = False):
    """급변 조건을 확인하고 넘으면 텔레그램 발송. 외부 스케줄러 전용.

    force=true  장 시간이 아니어도 조건을 확인한다
    test=true   조건에 안 걸려도 현재 시세를 한 번 보낸다 (연동 확인용)
    """
    now = datetime.now(KST)
    today = now.strftime("%Y-%m-%d")
    _reset_if_new_day(today)

    if not (force or test) and not _krx_open(now):
        return {"checked": False, "reason": "정규장 시간 아님", "at": now.strftime("%H:%M")}

    lines: list[str] = []
    seen: dict = {}

    # 프로세스가 막 떴다면(배포·재시작) 이번 판정은 기록만 하고 알리지 않는다.
    # 상태가 메모리에 있어 재시작마다 비는데, 그대로 두면 이미 몇 시간 전에
    # 넘어선 조건을 새로 넘은 것처럼 다시 알린다(2026-08-06에 실제로 그랬다).
    #
    # 기록할 값은 '지금 등락률'이 아니라 **당일 고가·저가가 밟은 계단**이다.
    # 지금 값으로 기록하면, 재시작 순간에 주가가 계단 아래로 물러나 있을 때
    # 0으로 잡히고 다시 올라올 때 또 알린다. 고가·저가는 시세에 남아 있어서
    # 재시작해도 같은 값이 복원된다 — 그래서 상태 저장소가 필요 없다.
    priming = not _sent.get("primed")
    _sent["primed"] = True

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
        if priming:
            # 오늘 고가·저가가 이미 밟은 계단 중 가장 큰 것을 기록해 둔다.
            reached = max(
                (stock_step(p) for p in (q.get("highPct"), q.get("lowPct"), pct) if p is not None),
                key=abs, default=0,
            )
            _sent[key] = reached
            continue
        if step != 0 and abs(step) > abs(_sent.get(key, 0)):
            lines.append(stock_message(name, q["last"], pct, step))
            _sent[key] = step

    # 사이드카 — 코스피200 선물
    try:
        fut = realtime_index("FUT")
        seen["선물"] = fut["changePct"]
        hit = sidecar_hit(fut["changePct"])
        if hit != 0 and _sent.get("sidecar") != hit:
            if not priming:
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
            if not priming:
                lines.append(circuit_message(step, kospi["changePct"]))
            _sent["circuit"] = step
    except Exception as e:
        seen["코스피"] = f"조회실패: {e}"

    result: dict = {}
    if lines:
        text = "📈 장중 알림\n\n" + "\n\n".join(lines) + "\n\n참고용이고 투자 권유가 아니에요."
        result = notify(text)
    elif test:
        # 연동이 실제로 되는지 확인용. 조건과 무관하게 현재 시세를 한 번 보낸다.
        quote_lines = "\n".join(
            f"  {k} {v:+.2f}%" if isinstance(v, (int, float)) else f"  {k} {v}"
            for k, v in seen.items()
        )
        result = notify(
            "🔔 장중 알림 연동 테스트\n\n현재 시세\n" + quote_lines
            + "\n\n실제 알림은 5% 단위 돌파·사이드카·서킷 조건에서만 옵니다."
        )

    return {
        "checked": True,
        "at": now.strftime("%H:%M"),
        "quotes": seen,
        "alerts": len(lines),
        # 한 채널만 성공해도 sent=true라 어느 쪽이 갔는지는 channels로 봐야 한다.
        "sent": bool(result.get("telegram") or result.get("kakao")),
        "channels": result,
    }


# 야간 갭 — 어느 종목을 어느 갭에서 알렸는지. {"session": "2026-08-06", "005930": 3.4}
_night: dict = {}

_NIGHT_THRESHOLD = float(os.environ.get("ALERT_THRESHOLD", "3.0"))
_NIGHT_STEP = float(os.environ.get("ALERT_STEP", "1.5"))


def _night_session(now: datetime) -> str:
    """야간 세션의 이름. 자정이 아니라 개장(09:00)을 기준으로 하루를 나눈다.

    16:00~다음날 08:30은 하나의 밤인데 자정 기준으로 날짜를 붙이면 00:00에
    '새 날'이 되어, 갭이 그대로여도 알림이 한 번 더 간다. 30분 간격일 때는
    티가 안 났지만 1분 간격에서는 그대로 중복 알림이 된다.
    """
    ref = now if now.hour >= 9 else now - timedelta(days=1)
    return ref.strftime("%Y-%m-%d")


def _session_start_ms(now: datetime) -> int:
    """이 밤이 시작된 시각(KRX 마감 15:30) — perp 캔들을 어디서부터 볼지."""
    day = now.date() if now.hour >= 9 else (now - timedelta(days=1)).date()
    start = datetime.combine(day, dt_time(15, 30), tzinfo=KST)
    return int(start.timestamp() * 1000)


def _night_open(now: datetime) -> bool:
    """KRX 정규장 밖 — 야간 perp 가격이 의미를 갖는 시간대(16:00~08:30)."""
    minutes = now.hour * 60 + now.minute
    return minutes >= 16 * 60 or minutes <= 8 * 60 + 30


def _night_should_alert(gap: float, last: float | None) -> bool:
    if abs(gap) < _NIGHT_THRESHOLD:
        return False
    if last is None:
        return True  # 이 밤의 첫 알림
    if (gap > 0) != (last > 0):
        return True  # 방향이 뒤집혔다 — 되돌림이 아니라 급반전이라 알린다
    # 같은 방향이면 더 벌어졌을 때만 (조금 되돌아오는 건 알리지 않는다)
    return abs(gap) - abs(last) >= _NIGHT_STEP


@router.get("/api/night-alert-check")
def api_night_alert_check(force: bool = False, test: bool = False):
    """야간 갭이 크게 벌어졌으면 알림. 외부 스케줄러 전용.

    force=true  시간대만 무시한다 (중복 방지는 그대로 — 안 그러면 1분마다 온다)
    test=true   조건에 안 걸려도 현재 갭을 한 번 보낸다 (연동 확인용)
    """
    now = datetime.now(KST)
    session = _night_session(now)
    if _night.get("session") != session:
        _night.clear()
        _night["session"] = session

    if not (force or test) and not _night_open(now):
        return {"checked": False, "reason": "야간 시간대 아님", "at": now.strftime("%H:%M")}

    # 장중 알림과 같은 이유로, 갓 뜬 프로세스는 이번 판정을 기록만 한다.
    # 재시작 때마다 상태가 비어 "이 밤의 첫 알림"이 되는 바람에, 갭이 -5.47%
    # -> -4.51% -> -4.13%로 **줄어드는데도** 알림이 계속 갔다(2026-08-06).
    priming = not _night.get("primed")
    _night["primed"] = True

    lines: list[str] = []
    seen: dict = {}
    for code, name in WATCH:
        try:
            # 갭 계산은 /api/night-price가 이미 하고 있다. 여기서 다시 짜면
            # 화면에 보이는 값과 알림 값이 갈라진다.
            d = api_night_price(code)
        except Exception as e:  # noqa: BLE001
            seen[name] = f"조회실패: {e}"
            continue
        if not d.get("available"):
            seen[name] = "야간 시세 없음"
            continue
        gap = d["gapPct"]
        seen[name] = gap
        if priming:
            # 지금 갭이 아니라 **이 밤에 가장 크게 벌어졌던 갭**을 기록한다.
            # 지금 값만 보면, 재시작 순간에 갭이 좁아져 있을 때 그걸 기준으로
            # 잡아 이미 알린 수준을 다시 알리게 된다. perp 캔들에 그 밤의
            # 고가·저가가 남아 있어 복원할 수 있다.
            worst = night_gap_extreme(code, _session_start_ms(now)) or gap
            # 임계 미만이면 기록하지 않는다. 기록해 두면 나중에 임계를 처음
            # 넘을 때 "직전 대비 1.5%p"를 못 채워 첫 알림을 삼킬 수 있다.
            if abs(worst) >= _NIGHT_THRESHOLD:
                _night[code] = worst
            continue
        # force는 시간대만 무시한다. 중복 방지까지 풀면 1분마다 같은 알림이 간다.
        if _night_should_alert(gap, _night.get(code)):
            arrow = "▲" if gap > 0 else "▼"
            lines.append(
                f"{arrow} {name} 야간 {gap:+.2f}%\n"
                f"   KRX종가 {d['krxClose']:,.0f}원 → 야간 {d['krw']:,.0f}원"
            )
            _night[code] = gap

    result: dict = {}
    if lines:
        result = notify(
            "🌙 야간 시세 알림\n\n" + "\n\n".join(lines)
            + "\n\nperp 기준 참고 정보이고 투자 권유가 아니에요."
        )
    elif test:
        quote_lines = "\n".join(
            f"  {k} {v:+.2f}%" if isinstance(v, (int, float)) else f"  {k} {v}"
            for k, v in seen.items()
        )
        result = notify(
            "🌙 야간 알림 연동 테스트\n\n현재 야간 갭\n" + quote_lines
            + f"\n\n실제 알림은 ±{_NIGHT_THRESHOLD}% 돌파 시에만 옵니다."
        )

    return {
        "checked": True,
        "at": now.strftime("%H:%M"),
        "session": session,
        "gaps": seen,
        "alerts": len(lines),
        "sent": bool(result.get("telegram") or result.get("kakao")),
        "channels": result,
    }


@router.get("/api/market-alert-config")
def api_market_alert_config():
    """알림이 켜져 있는지 확인용 (토큰 값은 노출하지 않는다)."""
    chats = [c for c in os.environ.get("TELEGRAM_CHAT_ID", "").split(",") if c.strip()]
    return {
        "telegramReady": bool(os.environ.get("TELEGRAM_BOT_TOKEN")) and bool(chats),
        "recipients": len(chats),
        "kakaoReady": kakao_configured(),
        "sentToday": {k: v for k, v in _sent.items() if k not in ("date", "primed")},
        "nightSent": {k: v for k, v in _night.items() if k not in ("session", "primed")},
    }


@router.get("/api/kakao-redirect-uri")
def api_kakao_redirect_uri(request: Request):
    """서버가 카카오에 보내는 redirect_uri.

    KOE006(앱 관리자 설정 오류)은 이 값이 카카오에 등록된 것과 한 글자라도
    다를 때 난다. 눈으로 대조할 수 있게 그대로 보여준다 (비밀값 아님).
    """
    key = os.environ.get("KAKAO_REST_API_KEY", "").strip()
    secret = os.environ.get("KAKAO_CLIENT_SECRET", "")
    return {
        "redirectUri": _redirect_uri(request),
        "appBaseUrlSet": bool(os.environ.get("APP_BASE_URL")),
        # 앱이 여러 개일 때 엉뚱한 앱의 키를 넣어도 KOE006이 난다. 앞 6자리만
        # 보여 카카오 개발자 화면의 REST API 키와 대조할 수 있게 한다.
        "restApiKeyPrefix": (key[:6] + "…") if key else None,
        "restApiKeyLength": len(key),
        # 앱에서 Client Secret을 켜뒀는데 여기에 없으면 토큰 교환이 401로 떨어진다.
        # 길이가 32가 아니면 잘려 들어간 것, strip 전후가 다르면 공백이 섞인 것이다.
        "clientSecretSet": bool(secret.strip()),
        "clientSecretLength": len(secret.strip()),
        "clientSecretHasWhitespace": secret != secret.strip(),
        "authorizeUrl": authorize_url(_redirect_uri(request)) if key else None,
        "hint": "이 값을 카카오 개발자 > 카카오 로그인 > Redirect URI 에 그대로 등록하세요",
    }


@router.get("/api/kakao-token-status")
def api_kakao_token_status():
    """리프레시 토큰 잔여일. 60일마다 사람이 갱신해야 해서 확인 수단을 둔다.

    잔여일은 카카오가 만료 1개월 미만일 때만 알려주므로, 그 전에는 null이다
    (= 아직 여유 있음).
    """
    if not kakao_configured():
        return {"configured": False}
    days = refresh_token_days_left()
    return {
        "configured": True,
        "refreshTokenDaysLeft": days,
        "needsAction": days is not None and days <= 14,
    }


@router.get("/api/kakao-test")
def api_kakao_test(key: str = ""):
    """카카오만 한 번 보내 본다.

    장중 알림 테스트는 텔레그램 그룹에도 같이 나가서 확인용으로 쓰기 부담스럽다.
    여기는 카카오만 건드리고, 실패하면 사유를 그대로 돌려준다.
    """
    admin = os.environ.get("ADMIN_KEY", "")
    if not admin or key != admin:
        return {"error": "관리자 전용"}
    ok = send_kakao("🔔 카카오 알림 연동 테스트입니다.", link_url=APP_URL)
    return {"sent": ok, "error": None if ok else kakao_last_error()}


@router.get("/api/alert-invite")
def api_alert_invite():
    """알림 그룹 초대 링크.

    링크를 아는 사람은 누구나 그룹에 들어올 수 있으니 저장소에 두지 않고
    TELEGRAM_INVITE_URL 환경변수로만 받는다. 안 설정하면 프런트가 버튼을 숨긴다.
    """
    url = os.environ.get("TELEGRAM_INVITE_URL", "").strip()
    return {"available": bool(url), "url": url or None}


def _redirect_uri(request: Request) -> str:
    """카카오에 등록한 것과 정확히 같아야 한다. 배포 도메인 기준으로 만든다."""
    base = os.environ.get("APP_BASE_URL", str(request.base_url)).rstrip("/")
    return base + REDIRECT_PATH


def _page(title: str, body: str) -> HTMLResponse:
    return HTMLResponse(
        "<!doctype html><meta charset=utf-8>"
        "<meta name=viewport content='width=device-width,initial-scale=1'>"
        f"<title>{title}</title>"
        "<style>body{background:#0A0C10;color:#E8EBF0;font-family:system-ui,sans-serif;"
        "margin:0;padding:24px;line-height:1.6}a{color:#E0A63C}"
        "code{display:block;background:#12151C;border:1px solid #232833;border-radius:8px;"
        "padding:12px;margin:12px 0;word-break:break-all;font-size:13px}"
        "h1{font-size:19px;margin:0 0 12px}.btn{display:inline-block;background:#12151C;"
        "border:1px solid #E0A63C;color:#E0A63C;border-radius:8px;padding:12px 18px;"
        "text-decoration:none;margin-top:8px}.muted{color:#8B94A3;font-size:13px}</style>"
        f"<h1>{title}</h1>{body}"
    )


@router.get("/api/kakao-auth", response_class=HTMLResponse)
def api_kakao_auth(request: Request, key: str = ""):
    """카카오 재인증 시작. 토큰이 노출되는 화면이라 관리자 키로 막는다."""
    admin = os.environ.get("ADMIN_KEY", "")
    if not admin or key != admin:
        return _page("접근 불가", "<p class=muted>관리자 전용 페이지입니다.</p>")
    if not os.environ.get("KAKAO_REST_API_KEY"):
        return _page("설정 필요", "<p class=muted>KAKAO_REST_API_KEY를 먼저 등록하세요.</p>")
    return _page(
        "카카오 알림 연결",
        "<p>아래 버튼을 눌러 카카오에 로그인하고 <b>카카오톡 메시지 전송</b>에 동의하세요.</p>"
        f"<a class=btn href='{authorize_url(_redirect_uri(request))}'>카카오 로그인하고 동의하기</a>"
        "<p class=muted>동의하면 다음 화면에 리프레시 토큰이 나옵니다. "
        "그 값을 Render 환경변수 KAKAO_REFRESH_TOKEN에 넣으면 연결이 끝나요.</p>",
    )


@router.get("/api/kakao-callback", response_class=HTMLResponse)
def api_kakao_callback(request: Request, code: str = "", error: str = ""):
    """동의 후 돌아오는 곳. 받은 리프레시 토큰을 복사할 수 있게 보여준다."""
    if error or not code:
        return _page("연결 취소됨", f"<p class=muted>{error or 'code가 없습니다.'}</p>")
    try:
        tok = exchange_code(code, _redirect_uri(request))
    except Exception as e:  # noqa: BLE001
        return _page("토큰 발급 실패", f"<p class=muted>{e}</p>")

    refresh = tok.get("refresh_token")
    if not refresh:
        return _page("토큰 발급 실패", f"<p class=muted>{tok}</p>")
    days = int(tok.get("refresh_token_expires_in", 0)) // 86400
    return _page(
        "연결 완료",
        "<p>아래 값을 Render 환경변수 <b>KAKAO_REFRESH_TOKEN</b>에 붙여넣으세요.</p>"
        f"<code>{refresh}</code>"
        f"<p class=muted>이 토큰은 약 {days}일 뒤 만료돼요. 그때 이 페이지에서 다시 받으면 됩니다.</p>",
    )
