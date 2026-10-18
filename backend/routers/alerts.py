"""Market/night alert checks with persistent deduplication and a shared cooldown."""

import logging
import math
import os
from html import escape
from datetime import datetime, timedelta, timezone
from datetime import time as dt_time

from fastapi import APIRouter, Request, Depends
from fastapi.responses import HTMLResponse
from security import require_alert_key, require_admin_key
from analysis.market_alerts import (
    circuit_message, circuit_step, sidecar_hit, sidecar_message, stock_message, stock_step,
)
from data.naver_index import realtime_index, realtime_quote
from data.kakao import REDIRECT_PATH, authorize_url, exchange_code
from data.kakao import is_configured as kakao_configured
from data.kakao import last_error as kakao_last_error
from data.kakao import refresh_token_days_left, send_kakao
from data.notify import APP_URL, notify
from routers.night import api_night_price, night_gap_extreme
from services.alert_delivery import (
    StateUnavailable, alert_state, complete_delivery, delivery_policy, read_state,
)

router = APIRouter()
logger = logging.getLogger(__name__)
KST = timezone(timedelta(hours=9))
WATCH = [("005930", "삼성전자"), ("000660", "SK하이닉스")]
_HOLD_SEC = 55
_NIGHT_THRESHOLD = float(os.environ.get("ALERT_THRESHOLD", "3.0"))
_NIGHT_STEP = float(os.environ.get("ALERT_STEP", "1.5"))


def _finite(value) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value)


def _held(state: dict, key: str, level: int, now: datetime) -> int | None:
    """Require consecutive observations; missing data or a long gap resets the hold."""
    holding = state.setdefault("holding", {})
    if level == 0:
        holding.pop(key, None)
        return None
    stamp = now.timestamp()
    prev = holding.get(key)
    if (not prev or prev["level"] != level
            or not 0 <= stamp - prev["last"] <= 90):
        holding[key] = {"level": level, "since": stamp, "last": stamp}
        return None
    prev["last"] = stamp
    held = int(stamp - prev["since"])
    return held if held >= _HOLD_SEC else None


def _krx_open(now: datetime) -> bool:
    if now.weekday() >= 5:
        return False
    minutes = now.hour * 60 + now.minute
    return 9 * 60 <= minutes <= 15 * 60 + 30


def _unavailable(now: datetime) -> dict:
    return {"checked": False, "reason": "state_unavailable", "at": now.strftime("%H:%M"),
            "alerts": 0, "sent": False, "deliveryStatus": "state_unavailable"}


def _dispatch(guard, attempt: int | None, text: str) -> tuple[dict, str]:
    if not text:
        return {}, "no_change"
    if attempt is None:
        return {}, "cooldown"
    try:
        channels = notify(text)
    except Exception as exc:
        logger.warning("Market alert delivery unconfirmed (%s)", type(exc).__name__)
        channels = {}
    sent = bool(channels.get("telegram") or channels.get("kakao"))
    complete_delivery(guard, attempt, sent)
    return channels, "sent" if sent else "delivery_unknown"


def _quote_lines(seen: dict) -> str:
    return "\n".join(f"  {k} {v:+.2f}%" if _finite(v) else f"  {k} {v}"
                     for k, v in seen.items())


@router.get("/api/market-alert-check", dependencies=[Depends(require_alert_key)])
def api_market_alert_check(force: bool = False, test: bool = False):
    """force/test may bypass market hours, but never bypass the delivery budget."""
    now = datetime.now(KST)
    if not (force or test) and not _krx_open(now):
        return {"checked": False, "reason": "정규장 시간 아님", "at": now.strftime("%H:%M")}
    today = now.strftime("%Y-%m-%d")
    quotes, indices, seen = {}, {}, {}
    # Network I/O stays outside the SQLite write transaction.
    for code, name in WATCH:
        try:
            q = realtime_quote(code)
            if not all(_finite(q.get(k)) for k in ("changePct", "last")):
                raise ValueError("Invalid quote")
            quotes[code] = q
            seen[name] = q["changePct"]
        except Exception as exc:
            seen[name] = f"조회실패: {type(exc).__name__}"
    for key, name in (("FUT", "선물"), ("KOSPI", "코스피")):
        try:
            q = realtime_index(key)
            if not _finite(q.get("changePct")):
                raise ValueError("Invalid index")
            indices[key] = q
            seen[name] = q["changePct"]
        except Exception as exc:
            seen[name] = f"조회실패: {type(exc).__name__}"
    lines = []
    try:
        with alert_state("market", today, now) as guard:
            state = guard.values
            levels = state.setdefault("levels", {})
            for code, name in WATCH:
                if code not in quotes:
                    continue
                q = quotes[code]
                key = f"stock:{code}"
                step = stock_step(q["changePct"])
                if key not in levels:
                    reached = [stock_step(p) for p in (q.get("highPct"), q.get("lowPct"), q["changePct"])
                               if _finite(p)]
                    levels[key] = {"up": max([0, *reached]), "down": abs(min([0, *reached]))}
                    continue
                direction = "up" if step > 0 else "down"
                if abs(step) > levels[key].get(direction, 0):
                    lines.append(stock_message(name, q["last"], q["changePct"], step))
                    levels[key][direction] = abs(step)

            fut = indices.get("FUT")
            if fut is None:
                _held(state, "sidecar", 0, now)
            elif "sidecar" not in levels:
                reached = [sidecar_hit(p) for p in (fut.get("highPct"), fut.get("lowPct"), fut["changePct"])
                           if _finite(p)]
                levels["sidecar"] = {"up": 1 in reached, "down": -1 in reached}
            else:
                hit = sidecar_hit(fut["changePct"])
                held = _held(state, "sidecar", hit, now)
                direction = "up" if hit > 0 else "down"
                if held is not None and not levels["sidecar"].get(direction):
                    lines.append(sidecar_message(hit, fut["changePct"], held))
                    levels["sidecar"][direction] = True

            kospi = indices.get("KOSPI")
            if kospi is None:
                _held(state, "circuit", 0, now)
            elif "circuit" not in levels:
                low = kospi.get("lowPct")
                levels["circuit"] = circuit_step(min(kospi["changePct"], low)
                                                if _finite(low) else kospi["changePct"])
            else:
                step = circuit_step(kospi["changePct"])
                held = _held(state, "circuit", step, now)
                if held is not None and step > levels["circuit"]:
                    lines.append(circuit_message(step, kospi["changePct"], held))
                    levels["circuit"] = step

            text = ("📈 장중 알림\n\n" + "\n\n".join(lines) + "\n\n참고용이고 투자 권유가 아니에요.") if lines else ""
            if test and not text:
                text = "🔔 장중 알림 연동 테스트\n\n현재 시세\n" + _quote_lines(seen)
            attempt = guard.reserve_delivery() if text else None
        # The observed levels and claim are durable before any message leaves.
    except StateUnavailable:
        return _unavailable(now)
    result, status = _dispatch(guard, attempt, text)
    return {"checked": True, "at": now.strftime("%H:%M"), "quotes": seen,
            "alerts": len(lines), "suppressed": len(lines) if status == "cooldown" else 0,
            "sent": bool(result.get("telegram") or result.get("kakao")),
            "channels": result, "deliveryStatus": status}


def _night_session(now: datetime) -> str:
    """16:00 to the following 08:30 is one session, including across midnight."""
    ref = now if now.hour >= 9 else now - timedelta(days=1)
    return ref.strftime("%Y-%m-%d")


def _session_start_ms(now: datetime) -> int:
    day = now.date() if now.hour >= 9 else (now - timedelta(days=1)).date()
    return int(datetime.combine(day, dt_time(15, 30), tzinfo=KST).timestamp() * 1000)


def _night_open(now: datetime) -> bool:
    minutes = now.hour * 60 + now.minute
    return minutes >= 16 * 60 or minutes <= 8 * 60 + 30


def _night_should_alert(gap: float, last: float | None) -> bool:
    # The caller keeps separate high-water marks for positive and negative gaps.
    return abs(gap) >= _NIGHT_THRESHOLD and (last is None or abs(gap) - abs(last) >= _NIGHT_STEP)


@router.get("/api/night-alert-check", dependencies=[Depends(require_alert_key)])
def api_night_alert_check(force: bool = False, test: bool = False):
    now = datetime.now(KST)
    session = _night_session(now)
    if not (force or test) and not _night_open(now):
        return {"checked": False, "reason": "야간 시간대 아님", "at": now.strftime("%H:%M")}
    previous = read_state("night", session).get("levels", {})
    quotes, extremes, seen = {}, {}, {}
    for code, name in WATCH:
        try:
            d = api_night_price(code)
            if not d.get("available"):
                seen[name] = "야간 시세 없음"
                continue
            if not all(_finite(d.get(k)) for k in ("gapPct", "krxClose", "krw")):
                raise ValueError("Invalid night quote")
            quotes[code] = d
            seen[name] = d["gapPct"]
            if code not in previous:
                # Only a symbol's first successful observation establishes its baseline.
                try:
                    extremes[code] = night_gap_extreme(code, _session_start_ms(now))
                except Exception:
                    extremes[code] = None
        except Exception as exc:
            seen[name] = f"조회실패: {type(exc).__name__}"
    lines = []
    try:
        with alert_state("night", session, now) as guard:
            levels = guard.values.setdefault("levels", {})
            for code, name in WATCH:
                if code not in quotes:
                    continue
                d = quotes[code]
                gap = d["gapPct"]
                if code not in levels:
                    levels[code] = {}
                    for p in (gap, extremes.get(code)):
                        if _finite(p) and abs(p) >= _NIGHT_THRESHOLD:
                            direction = "up" if p > 0 else "down"
                            levels[code][direction] = max(abs(p), levels[code].get(direction, 0))
                    continue
                direction = "up" if gap > 0 else "down"
                if _night_should_alert(gap, levels[code].get(direction)):
                    arrow = "▲" if gap > 0 else "▼"
                    lines.append(f"{arrow} {name} 야간 {gap:+.2f}%\n"
                                 f"   KRX종가 {d['krxClose']:,.0f}원 → 야간 {d['krw']:,.0f}원")
                    # Consume even a suppressed level. It must never be queued for later.
                    levels[code][direction] = abs(gap)
            text = ("🌙 야간 시세 알림\n\n" + "\n\n".join(lines)
                    + "\n\nperp 기준 참고 정보이고 투자 권유가 아니에요.") if lines else ""
            if test and not text:
                text = "🌙 야간 알림 연동 테스트\n\n현재 야간 갭\n" + _quote_lines(seen)
            attempt = guard.reserve_delivery() if text else None
    except StateUnavailable:
        return _unavailable(now)
    result, status = _dispatch(guard, attempt, text)
    return {"checked": True, "at": now.strftime("%H:%M"), "session": session, "gaps": seen,
            "alerts": len(lines), "suppressed": len(lines) if status == "cooldown" else 0,
            "sent": bool(result.get("telegram") or result.get("kakao")),
            "channels": result, "deliveryStatus": status}


@router.get("/api/market-alert-config")
def api_market_alert_config():
    """Public status omits credentials, recipients, and disk paths."""
    now = datetime.now(KST)
    market = read_state("market", now.strftime("%Y-%m-%d"))
    night = read_state("night", _night_session(now))
    chats = {c.strip() for c in os.environ.get("TELEGRAM_CHAT_ID", "").split(",") if c.strip()}
    return {
        "telegramReady": bool(os.environ.get("TELEGRAM_BOT_TOKEN")) and bool(chats),
        "recipients": len(chats), "kakaoReady": kakao_configured(),
        "sentToday": market.get("levels", {}), "nightSent": night.get("levels", {}),
        "holding": {k: {"level": h["level"], "since": datetime.fromtimestamp(h["since"], KST).strftime("%H:%M:%S")}
                    for k, h in market.get("holding", {}).items()},
        "deliveryPolicy": delivery_policy(),
    }


@router.get("/api/kakao-redirect-uri", dependencies=[Depends(require_admin_key)])
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


@router.get("/api/kakao-token-status", dependencies=[Depends(require_admin_key)])
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
        return _page("연결 취소됨", f"<p class=muted>{escape(error or 'code가 없습니다.')}</p>")
    try:
        tok = exchange_code(code, _redirect_uri(request))
    except Exception as e:  # noqa: BLE001
        return _page("토큰 발급 실패", f"<p class=muted>{escape(str(e))}</p>")

    refresh = tok.get("refresh_token")
    if not refresh:
        return _page("토큰 발급 실패", "<p class=muted>리프레시 토큰을 받지 못했습니다. 동의 항목을 확인해 주세요.</p>")
    days = int(tok.get("refresh_token_expires_in", 0)) // 86400
    return _page(
        "연결 완료",
        "<p>아래 값을 Render 환경변수 <b>KAKAO_REFRESH_TOKEN</b>에 붙여넣으세요.</p>"
        f"<code>{escape(str(refresh))}</code>"
        f"<p class=muted>이 토큰은 약 {days}일 뒤 만료돼요. 그때 이 페이지에서 다시 받으면 됩니다.</p>",
    )
