"""포트폴리오 진단 계산 — 네트워크 없이 도는 검사.

시세는 전부 지어낸 시계열이라 장이 열렸든 닫혔든 결과가 같다.
"""

import unittest

import pandas as pd

import analysis.portfolio as pf


def series(vals):
    return pd.Series(vals, index=pd.date_range("2026-05-01", periods=len(vals)), dtype=float)


FLAT = series([100 + (i % 3) for i in range(120)])


def one(ticker="005930", name="삼성전자", market="KR", qty=1, avg=100.0):
    return {"ticker": ticker, "name": name, "market": market, "qty": qty, "avg": avg}


class 비중과손익(unittest.TestCase):
    def test_한_종목이면_분산효과가_1(self):
        a = pf.analyze([one(qty=10, avg=200000)], {"005930": 240000}, {"005930": FLAT}, None)
        pf.sanity(a)
        self.assertEqual(a["concentration"]["count"], 1)
        self.assertAlmostEqual(a["concentration"]["effectiveN"], 1.0)
        self.assertAlmostEqual(a["totals"]["plPct"], 20.0)
        self.assertIn("전액", pf.observations(a)[0])

    def test_시세를_못_구하면_평단가로_대체되고_손익은_0(self):
        a = pf.analyze([one("UNKNOWN", "모름", qty=5, avg=1000)], {}, {}, None)
        pf.sanity(a)
        self.assertAlmostEqual(a["totals"]["plPct"], 0.0)
        self.assertEqual(a["themes"][0]["theme"], "기타")

    def test_보유가_없으면_None(self):
        self.assertIsNone(pf.analyze([], {}, {}, None))


class 레버리지(unittest.TestCase):
    def test_레버리지는_기초자산_테마로_접힌다(self):
        """0193T0을 SK하이닉스와 따로 세면 분산된 것처럼 보인다."""
        a = pf.analyze(
            [one("000660", "SK하이닉스", qty=10, avg=100000),
             one("0193T0", "하닉 레버", qty=10, avg=100000)],
            {"000660": 100000, "0193T0": 100000},
            {"000660": FLAT, "0193T0": FLAT}, None,
        )
        pf.sanity(a)
        self.assertEqual(len(a["themes"]), 1)
        self.assertEqual(a["themes"][0]["theme"], "반도체·메모리")
        self.assertAlmostEqual(a["themes"][0]["weight"], 100)

    def test_실효배수는_비중_가중(self):
        a = pf.analyze(
            [one("000660", "SK하이닉스", qty=10, avg=100000),
             one("0193T0", "하닉 레버", qty=10, avg=100000)],
            {"000660": 100000, "0193T0": 100000}, {}, None,
        )
        self.assertAlmostEqual(a["leverage"]["effective"], 1.5)  # 절반이 2배 상품
        self.assertAlmostEqual(a["leverage"]["weight"], 50)
        self.assertTrue(any("레버리지" in o for o in pf.observations(a)))


class 환율(unittest.TestCase):
    def test_미국_자산은_원화로_환산해_비중을_낸다(self):
        a = pf.analyze(
            [one(qty=10, avg=100000), one("SOXL", "SOXL", "US", qty=10, avg=50)],
            {"005930": 100000, "SOXL": 50}, {}, 2000.0,
        )
        pf.sanity(a)
        # 한국 100만원 vs 미국 50*10*2000 = 100만원
        self.assertAlmostEqual(a["usWeight"], 50)
        self.assertTrue(any("환율" in o for o in pf.observations(a)))

    def test_미국_자산이_있는데_환율이_없으면_계산을_포기한다(self):
        self.assertIsNone(
            pf.analyze([one("SOXL", "SOXL", "US", qty=1, avg=50)], {"SOXL": 50}, {}, None)
        )


class 보유기간(unittest.TestCase):
    def test_일지가_있으면_가장_오래된_매수부터_센다(self):
        a = pf.analyze(
            [one()], {"005930": 100}, {}, None,
            trades=[{"ticker": "005930", "date": "2026-07-06", "side": "buy"}],
            today="2026-08-06",
        )
        self.assertEqual(a["holdingDays"], 31)

    def test_일지가_없으면_보유기간은_생략된다(self):
        a = pf.analyze([one()], {"005930": 100}, {}, None, trades=[], today="2026-08-06")
        self.assertIsNone(a["holdingDays"])


class LLM캐시키(unittest.TestCase):
    def test_미세한_시세_변동에_캐시_키가_흔들리면_안_된다(self):
        """반올림을 빼먹으면 시세가 1원만 움직여도 LLM을 다시 부른다.

        반드시 2종목 이상으로 볼 것 — 한 종목이면 비중이 늘 100%라
        반올림을 빼도 값이 안 변해서, 검사가 통과해 버린다.
        """
        mk = lambda px: pf.context_for_llm(  # noqa: E731
            pf.analyze(
                [one(qty=3, avg=100000), one("000660", "SK하이닉스", qty=1, avg=100000)],
                {"005930": px, "000660": 500000}, {}, None,
            )
        )
        a, b = mk(123456.789), mk(123460.111)
        self.assertEqual(a, b)
        # 비중이 실제로 흔들리는 입력인지 확인 (아니면 이 검사는 아무것도 안 본다)
        self.assertNotEqual(
            pf.analyze([one(qty=3, avg=100000), one("000660", "SK하이닉스", qty=1, avg=100000)],
                       {"005930": 123456.789, "000660": 500000}, {}, None)["positions"][0]["weight"],
            pf.analyze([one(qty=3, avg=100000), one("000660", "SK하이닉스", qty=1, avg=100000)],
                       {"005930": 123460.111, "000660": 500000}, {}, None)["positions"][0]["weight"],
        )


if __name__ == "__main__":
    unittest.main()
