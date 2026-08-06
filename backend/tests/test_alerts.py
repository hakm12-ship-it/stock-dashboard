"""알림 중복 방지 — 2026-08-06에 실제로 깨졌던 부분.

상태가 프로세스 메모리에 있어서 배포마다 비는데, 그대로 두면 이미 몇 시간 전에
넘어선 조건을 새로 넘은 것처럼 다시 알린다. 갭이 -5.47% -> -4.51% -> -4.13%로
**줄어드는데도** 알림이 계속 갔다. 여기서 재시작을 흉내 내 그게 안 나는지 본다.

발송은 전부 가로채므로 실제로 메시지가 나가지 않는다.
"""

import unittest
from datetime import datetime

import routers.alerts as A

NIGHT = datetime(2026, 8, 6, 3, 0, tzinfo=A.KST)
DAY = datetime(2026, 8, 6, 10, 0, tzinfo=A.KST)


class _Base(unittest.TestCase):
    def setUp(self):
        self.sent = []
        self._notify = A.notify
        A.notify = lambda text: (self.sent.append(text), {"telegram": True, "kakao": False})[1]
        self.restart()

    def tearDown(self):
        A.notify = self._notify

    def restart(self):
        """프로세스 재시작 = 메모리 상태 소멸."""
        A._night.clear()
        A._sent.clear()

    def _at(self, now):
        real = A.datetime

        class Fake(real):
            @classmethod
            def now(cls, tz=None):
                return now

        return real, Fake

    def night(self, gap, now=NIGHT, worst=None):
        """worst = 이 밤에 가장 크게 벌어졌던 갭 (perp 캔들에서 복원되는 값)."""
        A.api_night_price = lambda code: {
            "available": True, "gapPct": gap,
            "krxClose": 1_668_000, "krw": 1_668_000 * (1 + gap / 100),
        }
        A.night_gap_extreme = lambda code, since: gap if worst is None else worst
        real, fake = self._at(now)
        A.datetime = fake
        try:
            return A.api_night_alert_check()
        finally:
            A.datetime = real

    def day(self, pct, now=DAY, high=None, low=None):
        """high/low = 당일 고가·저가의 등락률. 재시작 후 상태 복원에 쓰인다."""
        A.realtime_quote = lambda code: {
            "changePct": pct, "last": 1_668_000,
            "highPct": pct if high is None else high,
            "lowPct": pct if low is None else low,
        }
        A.realtime_index = lambda name: {"changePct": 0.5, "last": 100}
        real, fake = self._at(now)
        A.datetime = fake
        try:
            return A.api_market_alert_check()
        finally:
            A.datetime = real


class 야간갭(_Base):
    def test_재시작_직후_첫_확인은_알리지_않는다(self):
        self.night(-5.47)
        self.assertEqual(self.sent, [])

    def test_갭이_줄어들면_알리지_않는다(self):
        self.night(-5.47)          # 프라이밍
        self.night(-4.51)
        self.night(-4.13)
        self.assertEqual(self.sent, [])

    def test_재시작을_끼워도_줄어드는_갭은_조용하다(self):
        """실제로 났던 증상 그대로."""
        self.night(-5.47)
        self.restart()
        self.night(-4.51)
        self.restart()
        self.night(-4.13)
        self.assertEqual(self.sent, [])

    def test_정말_더_벌어지면_알린다(self):
        self.night(-4.51)          # 프라이밍
        self.night(-7.20)          # 2.69%p 악화
        self.assertEqual(len(self.sent), 1)
        self.assertIn("-7.20%", self.sent[0])

    def test_방향이_뒤집히면_즉시_알린다(self):
        self.night(-4.51)
        self.night(+4.00)
        self.assertEqual(len(self.sent), 1)

    def test_임계_미만에서_재시작해도_첫_돌파를_삼키지_않는다(self):
        """프라이밍이 -1%를 기록해 버리면 -3.5%가 '1.5%p 차이'를 못 채운다."""
        self.night(-1.00)
        self.night(-3.50)
        self.assertEqual(len(self.sent), 1)

    def test_재시작_시점에_갭이_좁아져_있어도_다시_알리지_않는다(self):
        """이 밤에 이미 -7%까지 벌어졌는데 재시작 순간엔 -3%로 좁아진 상황."""
        self.night(-3.0, worst=-7.2)   # 프라이밍 — 기록은 -7.2
        self.night(-6.5, worst=-7.2)   # 아직 -7.2 안쪽
        self.assertEqual(self.sent, [])
        self.night(-9.0, worst=-9.0)   # 진짜로 더 벌어졌다
        self.assertEqual(len(self.sent), 1)

    def test_야간_시간대가_아니면_건너뛴다(self):
        r = self.night(-9.0, now=datetime(2026, 8, 6, 12, 0, tzinfo=A.KST))
        self.assertFalse(r["checked"])
        self.assertEqual(self.sent, [])


class 야간세션경계(unittest.TestCase):
    def test_자정을_넘어도_같은_밤이다(self):
        """자정 기준으로 나누면 00:00에 같은 갭으로 알림이 한 번 더 간다."""
        d = lambda h, day=6: datetime(2026, 8, day, h, 0, tzinfo=A.KST)  # noqa: E731
        self.assertEqual(A._night_session(d(23, 6)), A._night_session(d(1, 7)))
        self.assertEqual(A._night_session(d(8, 7)), "2026-08-06")   # 개장 전은 전날 밤
        self.assertEqual(A._night_session(d(16, 7)), "2026-08-07")  # 마감 후는 그날 밤

    def test_야간_시간대는_16시부터_다음날_8시30분까지(self):
        d = lambda h, m=0: datetime(2026, 8, 6, h, m, tzinfo=A.KST)  # noqa: E731
        for t in (d(16), d(23, 59), d(0), d(8, 30)):
            self.assertTrue(A._night_open(t), t)
        for t in (d(8, 31), d(12), d(15, 59)):
            self.assertFalse(A._night_open(t), t)


class 장중급변(_Base):
    def test_재시작_직후_이미_넘어선_계단을_다시_알리지_않는다(self):
        self.day(5.77)
        self.assertEqual(self.sent, [])
        self.day(5.77)
        self.assertEqual(self.sent, [])

    def test_다음_계단을_넘으면_알린다(self):
        self.day(5.77)   # 프라이밍
        self.day(10.4)
        self.assertEqual(len(self.sent), 1)

    def test_정규장이_아니면_건너뛴다(self):
        r = self.day(9.9, now=datetime(2026, 8, 6, 22, 0, tzinfo=A.KST))
        self.assertFalse(r["checked"])
        self.assertEqual(self.sent, [])

    def test_재시작_시점에_계단_아래로_물러나_있어도_다시_알리지_않는다(self):
        """지금 값만 보고 기록하면 여기서 중복이 난다.

        오늘 이미 +5.8%를 찍었는데 재시작 순간엔 +3%로 물러나 있는 상황.
        '지금 +3% -> 계단 0'으로 기록하면, 다시 +5.2%가 될 때 새로 넘은 것처럼
        알린다. 당일 고가(+5.8%)를 보고 기록해야 조용하다.
        """
        self.day(3.0, high=5.8, low=-0.5)   # 프라이밍
        self.assertEqual(self.sent, [])
        self.day(5.2, high=5.8, low=-0.5)   # 고가 밑이라 새 계단이 아니다
        self.assertEqual(self.sent, [])

    def test_하락도_당일_저가를_기준으로_복원한다(self):
        self.day(-2.0, high=1.0, low=-9.8)  # 오늘 이미 -5% 계단을 밟았다
        self.day(-6.0, high=1.0, low=-9.8)
        self.assertEqual(self.sent, [])
        self.day(-11.0, high=1.0, low=-11.0)  # -10% 계단은 새로 밟았다
        self.assertEqual(len(self.sent), 1)


if __name__ == "__main__":
    unittest.main()
