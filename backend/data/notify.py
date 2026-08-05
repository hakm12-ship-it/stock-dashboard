"""알림 발송 창구 — 텔레그램 + 카카오 '나에게 보내기'.

호출부는 여기만 부른다. 경로를 늘릴 때 알림 지점마다 코드를 고치면
한 곳을 빠뜨려서 "야간 알림은 오는데 장중 알림은 안 오는" 식이 된다.

텔레그램은 그룹까지 여러 명, 카카오는 본인 한 명이다(친구 전송은 별도 심사).
"""

from data.kakao import is_configured as kakao_configured
from data.kakao import last_error as kakao_last_error
from data.kakao import send_kakao
from data.telegram import send_telegram

APP_URL = "https://stock-insight-zws6.onrender.com"


def notify(text: str) -> dict:
    """모든 경로로 보내고 각각의 성공 여부를 돌려준다.

    한쪽이 실패해도 다른 쪽은 계속 보낸다 — 카카오 토큰이 만료됐다고
    텔레그램 알림까지 멈추면 안 된다.
    """
    telegram = send_telegram(text)
    kakao = send_kakao(text, link_url=APP_URL) if kakao_configured() else False
    out = {"telegram": telegram, "kakao": kakao}
    if not kakao:
        # 한쪽만 실패하면 전체는 성공으로 보여서 놓치기 쉽다. 사유를 같이 돌려준다.
        out["kakaoError"] = kakao_last_error() or "카카오 미설정"
    return out
