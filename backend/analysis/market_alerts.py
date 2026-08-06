"""장중 급변 알림 규칙 — 사이드카·서킷브레이커 조건과 개별 종목 등락 단계.

**공식 발동과 조건 도달은 다르다.** 사이드카·서킷브레이커는 조건이 1분간
지속돼야 거래소가 발동하고, 하루 한 번·특정 시간대 제한 등 세부 규정도 있다.
여기서 판정하는 건 "발동 조건에 도달했다"까지이고, 문구에도 그렇게 쓴다.

기준(KRX):
  사이드카   — 코스피200 선물 ±5% (코스닥150은 ±6%)
  서킷브레이커 — 코스피 지수 하락 8% / 15% / 20% 3단계
"""

SIDECAR_PCT = 5.0
CIRCUIT_STEPS = (8.0, 15.0, 20.0)
# 개별 종목은 5% 단위로 계단을 올린다 (5, 10, 15, ...). 상·하한가가 ±30%라 그 안에서 움직인다.
STOCK_STEP = 5.0


def stock_step(pct: float) -> int:
    """등락률이 몇 번째 5% 계단인지. 3.9%→0, 5.2%→1, -11%→-2."""
    step = int(abs(pct) // STOCK_STEP)
    return step if pct >= 0 else -step


def circuit_step(pct: float) -> int:
    """서킷브레이커 몇 단계 조건인지 (하락만). 미달이면 0."""
    if pct >= 0:
        return 0
    for i, threshold in enumerate(reversed(CIRCUIT_STEPS), start=1):
        if abs(pct) >= threshold:
            return len(CIRCUIT_STEPS) - i + 1
    return 0


def sidecar_hit(futures_pct: float) -> int:
    """사이드카 조건이면 방향(+1/-1), 아니면 0."""
    if abs(futures_pct) < SIDECAR_PCT:
        return 0
    return 1 if futures_pct > 0 else -1


def stock_message(name: str, price: float, pct: float, step: int) -> str:
    arrow = "▲" if step > 0 else "▼"
    return f"{arrow} {name} {pct:+.2f}%  {price:,.0f}원  ({abs(step) * STOCK_STEP:.0f}% 돌파)"


def sidecar_message(direction: int, futures_pct: float, held_sec: int) -> str:
    kind = "매수" if direction > 0 else "매도"
    return (
        f"⚡ 사이드카 조건 지속 — 코스피200 선물 {futures_pct:+.2f}%\n"
        f"   선물 {kind}호가 효력정지 조건(±{SIDECAR_PCT:.0f}%)을 "
        f"{held_sec}초째 유지 중입니다.\n"
        f"   발동 요건인 1분을 넘겼어요 (거래소 발표는 별도)."
    )


def circuit_message(step: int, index_pct: float, held_sec: int) -> str:
    threshold = CIRCUIT_STEPS[step - 1]
    tail = "당일 장 종료" if step == 3 else "20분간 매매 중단"
    return (
        f"🚨 서킷브레이커 {step}단계 조건 지속 — 코스피 {index_pct:+.2f}%\n"
        f"   {threshold:.0f}% 하락 조건을 {held_sec}초째 유지 중이며, "
        f"발동 시 {tail}입니다.\n"
        f"   발동 요건인 1분을 넘겼어요 (거래소 발표는 별도)."
    )
