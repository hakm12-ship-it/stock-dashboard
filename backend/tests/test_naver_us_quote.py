"""네이버 미국 시세 — 거래소 접미사 탐색과 클래스 주식 코드.

네이버는 AAPL을 AAPL.O로, SPY·VOO 같은 NYSE Arca ETF는 접미사 없는 SPY로,
BRK-B는 BRKb로만 받는다. 맞지 않는 코드는 409. 네트워크는 전부 가짜로 바꾼다.
"""

import io
import json
import unittest
import urllib.error
from unittest.mock import patch

import data.naver_stock as N
import routers.prices as prices

_PREFIX = "https://api.stock.naver.com/stock/"


def _basic(close="755.72"):
    return {
        "closePrice": close,
        "localTradedAt": "2026-10-30T16:00:00-04:00",
        "fluctuationsRatio": "0.10",
        "marketStatus": "CLOSE",
    }


class _FakeNaver:
    """네이버 /stock/{code}/basic 흉내. 등록된 코드만 200, 나머지는 409."""

    def __init__(self, known):
        self.known = known
        self.calls = []

    def __call__(self, req, timeout=None):
        url = req.full_url
        assert url.startswith(_PREFIX) and url.endswith("/basic"), url
        code = url[len(_PREFIX):-len("/basic")]
        self.calls.append(code)
        if code not in self.known:
            raise urllib.error.HTTPError(url, 409, "Conflict", {}, io.BytesIO(b"{}"))
        return io.BytesIO(json.dumps(self.known[code]).encode())


class NaverUsQuoteTests(unittest.TestCase):
    def setUp(self):
        N._us_suffix_cache.clear()

    def fake(self, known):
        naver = _FakeNaver(known)
        patcher = patch.object(N.urllib.request, "urlopen", naver)
        patcher.start()
        self.addCleanup(patcher.stop)
        return naver

    def test_arca_etf_falls_back_to_bare_code_and_remembers_it(self):
        naver = self.fake({"SPY": _basic("755.72")})

        q = N.naver_us_quote("SPY")

        self.assertEqual(q["close"], 755.72)
        self.assertEqual(q["tradedAt"], "2026-10-30T16:00:00-04:00")
        self.assertFalse(q["marketOpen"])
        self.assertEqual(naver.calls, ["SPY.O", "SPY.K", "SPY.N", "SPY"])

        naver.calls.clear()
        N.naver_us_quote("SPY")
        self.assertEqual(naver.calls, ["SPY"])

    def test_nasdaq_code_is_still_tried_first(self):
        naver = self.fake({"AAPL.O": _basic("270.37")})

        self.assertEqual(N.naver_us_quote("AAPL")["close"], 270.37)
        self.assertEqual(naver.calls, ["AAPL.O"])

    def test_unknown_ticker_raises_after_every_suffix_and_is_not_cached(self):
        naver = self.fake({})

        with self.assertRaisesRegex(RuntimeError, "ZZZZ 시세를 찾지 못함"):
            N.naver_us_quote("ZZZZ")
        self.assertEqual(naver.calls, ["ZZZZ.O", "ZZZZ.K", "ZZZZ.N", "ZZZZ"])
        self.assertNotIn("ZZZZ", N._us_suffix_cache)

    def test_dash_share_class_uses_naver_lowercase_class_code(self):
        naver = self.fake({"BRKb": _basic("542.49"), "BFb": _basic("28.71")})

        self.assertEqual(N.naver_us_quote("BRK-B")["close"], 542.49)
        self.assertEqual(N.naver_us_quote("BF-B")["close"], 28.71)
        self.assertEqual(naver.calls, ["BRKb", "BFb"])

    def test_unknown_dash_ticker_fails_after_one_request(self):
        naver = self.fake({})

        with self.assertRaisesRegex(RuntimeError, "ABC-X 시세를 찾지 못함"):
            N.naver_us_quote("ABC-X")
        self.assertEqual(naver.calls, ["ABCx"])

    def test_quotes_endpoint_accepts_dash_and_arca_tickers(self):
        # 다른 테스트와 ttl_cache 항목이 겹치지 않게 이 테스트에서만 쓰는 종목을 쓴다.
        self.fake({"LENb": _basic("120.50"), "IWM": _basic("245.10")})

        out = prices.api_quotes("US", "len-b, IWM")

        self.assertEqual([r["ticker"] for r in out], ["LEN-B", "IWM"])
        self.assertEqual([r.get("price") for r in out], [120.5, 245.1])
        self.assertTrue(all("error" not in r for r in out))


if __name__ == "__main__":
    unittest.main()
