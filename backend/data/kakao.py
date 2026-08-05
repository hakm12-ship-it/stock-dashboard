"""카카오톡 '나에게 보내기' — 텔레그램과 함께 알림을 받는 경로.

텔레그램 봇 토큰과 달리 카카오는 OAuth라 토큰이 만료된다:
    액세스 토큰   약 12시간  — 서버가 리프레시 토큰으로 알아서 갱신한다
    리프레시 토큰 약 60일    — 이건 사람이 다시 받아 환경변수에 넣어야 한다

리프레시 토큰은 만료 1개월 전부터 갱신본이 내려오지만, 앱이 환경변수를 못
고치고 무료 플랜은 재시작 시 디스크가 날아가서 저장할 곳이 없다. 그래서
만료가 다가오면 알려주고 사람이 교체하는 방식으로 간다.

환경변수:
    KAKAO_REST_API_KEY   앱의 REST API 키
    KAKAO_REFRESH_TOKEN  최초 인증으로 받은 리프레시 토큰
    KAKAO_CLIENT_SECRET  (선택) 앱에서 켜뒀다면 필요
"""

import json
import os
import time
import urllib.parse
import urllib.request

_TOKEN_URL = "https://kauth.kakao.com/oauth/token"
_MEMO_URL = "https://kapi.kakao.com/v2/api/talk/memo/default/send"

# 발급받은 액세스 토큰을 메모리에 들고 있는다. (값, 만료시각)
_access: tuple[str, float] | None = None


def is_configured() -> bool:
    return bool(os.environ.get("KAKAO_REST_API_KEY") and os.environ.get("KAKAO_REFRESH_TOKEN"))


REDIRECT_PATH = "/api/kakao-callback"
_AUTHORIZE_URL = "https://kauth.kakao.com/oauth/authorize"


def authorize_url(redirect_uri: str) -> str:
    """동의 화면 주소. talk_message 권한만 요청한다."""
    params = {
        "client_id": os.environ.get("KAKAO_REST_API_KEY", ""),
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "talk_message",
    }
    return f"{_AUTHORIZE_URL}?{urllib.parse.urlencode(params)}"


def exchange_code(code: str, redirect_uri: str) -> dict:
    """동의 후 받은 code를 토큰으로 교환. 리프레시 토큰을 사람이 저장해야 한다."""
    params = {
        "grant_type": "authorization_code",
        "client_id": os.environ.get("KAKAO_REST_API_KEY", ""),
        "redirect_uri": redirect_uri,
        "code": code,
    }
    secret = os.environ.get("KAKAO_CLIENT_SECRET")
    if secret:
        params["client_secret"] = secret
    return _post(_TOKEN_URL, params)


def _post(url: str, params: dict, headers: dict | None = None) -> dict:
    req = urllib.request.Request(
        url,
        data=urllib.parse.urlencode(params).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded", **(headers or {})},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def _get_access_token() -> str:
    """유효한 액세스 토큰. 만료가 가까우면 리프레시로 새로 받는다."""
    global _access
    if _access and time.time() < _access[1]:
        return _access[0]

    key = os.environ.get("KAKAO_REST_API_KEY")
    refresh = os.environ.get("KAKAO_REFRESH_TOKEN")
    if not key or not refresh:
        raise RuntimeError("KAKAO_REST_API_KEY / KAKAO_REFRESH_TOKEN 미설정")

    params = {"grant_type": "refresh_token", "client_id": key, "refresh_token": refresh}
    secret = os.environ.get("KAKAO_CLIENT_SECRET")
    if secret:
        params["client_secret"] = secret

    d = _post(_TOKEN_URL, params)
    token = d["access_token"]
    # 실제 만료보다 5분 일찍 만료된 것으로 취급해 경계에서 실패하지 않게 한다.
    _access = (token, time.time() + max(60, d.get("expires_in", 43199) - 300))
    return token


def refresh_token_days_left() -> int | None:
    """리프레시 토큰 잔여일. 갱신 응답에 포함될 때만 알 수 있어 보통 None."""
    key = os.environ.get("KAKAO_REST_API_KEY")
    refresh = os.environ.get("KAKAO_REFRESH_TOKEN")
    if not key or not refresh:
        return None
    params = {"grant_type": "refresh_token", "client_id": key, "refresh_token": refresh}
    secret = os.environ.get("KAKAO_CLIENT_SECRET")
    if secret:
        params["client_secret"] = secret
    try:
        d = _post(_TOKEN_URL, params)
    except Exception:
        return None
    left = d.get("refresh_token_expires_in")
    return int(left // 86400) if left else None


def send_kakao(text: str, link_url: str | None = None) -> bool:
    """나에게 보내기. 설정이 없으면 조용히 False (텔레그램만 쓰는 상태)."""
    if not is_configured():
        return False
    try:
        token = _get_access_token()
        template = {
            "object_type": "text",
            "text": text[:900],  # 카카오 텍스트 템플릿 상한
            "link": {"web_url": link_url, "mobile_web_url": link_url} if link_url else {},
        }
        d = _post(
            _MEMO_URL,
            {"template_object": json.dumps(template, ensure_ascii=False)},
            {"Authorization": f"Bearer {token}"},
        )
        return d.get("result_code") == 0
    except Exception as e:  # noqa: BLE001
        print(f"[카카오] 전송 실패: {e}")
        return False
