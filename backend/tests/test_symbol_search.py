"""종목검색 순서와 시세 없는 종목 — /api/symbols, /api/prices, /api/indicators.

검색은 같은 순위끼리 티커순으로 줄 세워 0000H0 같은 신규 코드가 KODEX 200·
삼성전자보다 먼저 나왔고, 100개 상한에 큰 종목이 잘렸다. 시세가 없는 종목
("BRK B" 등)은 처리 안 된 500이 났다. 네트워크는 전부 가짜로 바꾼다.
"""

import unittest
from unittest.mock import patch

import pandas as pd
import requests
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routers.prices as prices

# 상장목록 순서 = 시가총액순 (FDR KRX 주식 다음에 네이버 ETF 목록).
_KR = pd.DataFrame({
    "ticker": ["005930", "000660", "028260", "000070",
               "069500", "360750", "379800", "0000H0", "0005A0", "0007F0"],
    "name": ["삼성전자", "SK하이닉스", "삼성물산", "삼양홀딩스",
             "KODEX 200", "TIGER 미국S&P500", "KODEX 미국S&P500", "KODEX 인도Nifty미드캡100",
             "KODEX 신규", "TIGER 미국신규"],
})


def _search(q, table=_KR):
    with patch.object(prices, "cached_symbols", return_value=table):
        return [r["ticker"] for r in prices.api_symbols("KR", q)]


def _candles(n=5):
    idx = pd.bdate_range(end="2026-10-30", periods=n)
    return pd.DataFrame({"Open": 1.0, "High": 2.0, "Low": 0.5, "Close": 1.5, "Volume": 10}, index=idx)


def _http_error(status):
    resp = requests.Response()
    resp.status_code = status
    return requests.HTTPError(f"{status}", response=resp)


class 종목검색_순서(unittest.TestCase):
    def test_같은_순위는_상장목록_순서를_지킨다(self):
        # 티커순이면 0000H0·0005A0이 KODEX 200보다 앞선다.
        self.assertEqual(_search("kodex"), ["069500", "379800", "0000H0", "0005A0"])
        self.assertEqual(_search("tiger 미국"), ["360750", "0007F0"])
        self.assertEqual(_search("삼"), ["005930", "028260", "000070"])

    def test_순위는_그대로_티커_일치가_먼저다(self):
        table = pd.DataFrame({"ticker": ["BVN", "NAVN", "NAVI"],
                              "name": ["Buenaventura", "Navan", "Navient"]})
        with patch.object(prices, "cached_symbols", return_value=table):
            self.assertEqual([r["ticker"] for r in prices.api_symbols("US", "nav")], ["NAVN", "NAVI", "BVN"])
            self.assertEqual([r["ticker"] for r in prices.api_symbols("US", "navi")], ["NAVI"])

    def test_클래스주는_공백이나_점으로_쳐도_찾는다(self):
        table = pd.DataFrame({"ticker": ["BRK-A", "BRK-B", "AAPL"],
                              "name": ["Berkshire Hathaway Inc Class A", "Berkshire Hathaway Inc Class B", "Apple Inc."]})
        with patch.object(prices, "cached_symbols", return_value=table):
            for q in ("BRK B", "brk.b", "BRK-B", " brk  b "):
                with self.subTest(q=q):
                    self.assertEqual([r["ticker"] for r in prices.api_symbols("US", q)], ["BRK-B"])
            self.assertEqual([r["ticker"] for r in prices.api_symbols("US", "apple inc.")], ["AAPL"])

    def test_상한에_걸려도_큰_종목이_남는다(self):
        n = prices.SYMBOL_LIMIT + 20
        # 신규 코드 펀드가 많아도 목록 앞쪽(시가총액 상위)인 KODEX 200은 잘리지 않는다.
        table = pd.DataFrame({"ticker": ["069500"] + [f"{i:04d}A0" for i in range(n)],
                              "name": ["KODEX 200"] + [f"KODEX 신규{i}" for i in range(n)]})
        out = _search("kodex", table)
        self.assertEqual(len(out), prices.SYMBOL_LIMIT)
        self.assertEqual(out[0], "069500")

    def test_공백만_있는_검색어는_빈_검색어와_같다(self):
        self.assertEqual(_search("  "), _search(""))
        self.assertEqual(_search(" 삼성전자 "), ["005930"])


class 시세_없는_종목(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(prices.router)
        self.client = TestClient(app)

    def _get(self, path, error=None, value=None):
        target = "load_with_warmup" if path == "/api/indicators" else "load"
        with patch.object(prices, target, side_effect=error, return_value=value):
            return self.client.get(path, params={"ticker": "BRK B", "period": "3m"})

    def test_데이터가_없으면_한글_안내와_함께_404(self):
        cases = [
            ("야후 404", _http_error(404), None),
            ("빈 국내 시세표", KeyError("Close"), None),
            ("빈 표", None, pd.DataFrame()),
        ]
        for label, error, value in cases:
            with self.subTest(label):
                r = self._get("/api/prices", error, value)
                self.assertEqual(r.status_code, 404)
                self.assertEqual(r.json()["detail"], "이 종목의 시세 데이터를 찾을 수 없습니다.")

    def test_지표도_데이터가_없으면_404(self):
        r = self._get("/api/indicators", value=(pd.DataFrame(), 0))
        self.assertEqual(r.status_code, 404)
        r = self._get("/api/indicators", error=_http_error(404))
        self.assertEqual(r.status_code, 404)

    def test_시세_제공처_장애는_없는_종목으로_말하지_않는다(self):
        # 502·504는 프록시가 "서버 꺼짐"으로 바꾸므로 앱은 503을 쓴다.
        for error in (requests.ConnectionError("reset"), _http_error(429)):
            with self.subTest(repr(error)), patch("builtins.print"):
                r = self._get("/api/prices", error)
                self.assertEqual(r.status_code, 503)
                self.assertIn("잠시 후 다시", r.json()["detail"])

    def test_시세가_있으면_그대로_돌려준다(self):
        r = self._get("/api/prices", value=_candles())
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()), 5)
        r = self._get("/api/indicators", value=(_candles(80), 20))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()["time"]), 60)


if __name__ == "__main__":
    unittest.main()
