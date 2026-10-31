"""종목검색 목록 — 만료돼도 기다리지 않는 캐시, 시간 제한 있는 미국 목록 다운로드.

미국 목록은 FDR로 받으면 네이버를 60개씩 약 215번 순서대로 불러 34초가 걸렸고,
캐시가 하루 한 번 만료될 때마다 그 뒤 첫 검색이 그만큼 기다렸다.
네트워크는 전부 가짜로 바꾼다.
"""

import threading
import time
import unittest
from unittest.mock import patch

import pandas as pd
import requests

import cache
import data.symbols as S
import deps
import routers.prices as prices
from cache import stale_while_revalidate

_NASDAQ = S._NAVER_STOCKS.format("NASDAQ")
_NYSE = S._NAVER_STOCKS.format("NYSE")


class _Clock:
    def __init__(self):
        self.now = 1000.0

    def time(self):
        return self.now


def _join_refreshes():
    for t in threading.enumerate():
        if t.name.startswith("refresh-"):
            t.join(5)


class _Resp:
    def __init__(self, body, status=200):
        self.body, self.status = body, status

    def raise_for_status(self):
        if self.status >= 400:
            raise requests.HTTPError(str(self.status))

    def json(self):
        return self.body


class _FakeNaver:
    """URL마다 정해진 종목 수를 페이지로 나눠 돌려주는 가짜 네이버."""

    def __init__(self, sizes, hook=None):
        self.sizes = sizes
        self.hook = hook
        self.calls = []
        self._lock = threading.Lock()

    def rows(self, url):
        prefix = {_NASDAQ: "N", _NYSE: "Y", S._NAVER_US_ETF: "E"}[url]
        rows = [{"symbolCode": f"{prefix}{i}", "stockNameEng": f"{prefix} Corp {i}"}
                for i in range(self.sizes[url])]
        if prefix == "E":
            rows[0] = {"symbolCode": "N0", "stockNameEng": "중복"}       # 주식과 겹치는 티커
            rows[1] = {"symbolCode": "E1", "stockNameEng": None}        # 이름 없는 행
        return rows

    def __call__(self, url, params=None, headers=None, timeout=None):
        page, size = params["page"], params["pageSize"]
        with self._lock:
            self.calls.append((url, page, size, timeout))
        if self.hook:
            self.hook(url, page)
        rows = self.rows(url)
        key = "etfs" if url == S._NAVER_US_ETF else "stocks"
        return _Resp({"totalCount": len(rows), key: rows[(page - 1) * size:page * size]})


class 지난값을_먼저_주는_캐시(unittest.TestCase):
    def setUp(self):
        self.clock = _Clock()
        p = patch.object(cache, "time", self.clock)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(_join_refreshes)

    def test_값이_없으면_한_번만_받고_동시_요청은_그걸_기다린다(self):
        calls = []

        @stale_while_revalidate(60)
        def load(market):
            calls.append(market)
            time.sleep(0.2)
            return "목록"

        results = []
        ts = [threading.Thread(target=lambda: results.append(load("미국"))) for _ in range(5)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        self.assertEqual(calls, ["미국"])
        self.assertEqual(results, ["목록"] * 5)

    def test_만료된_값은_바로_주고_갱신은_뒤에서_한_번만_한다(self):
        calls, started, release = [], threading.Event(), threading.Event()

        @stale_while_revalidate(60)
        def load(market):
            calls.append(market)
            if len(calls) > 1:
                started.set()
                release.wait(5)
            return f"v{len(calls)}"

        self.assertEqual(load("미국"), "v1")
        self.clock.now += 61

        results = []
        begin = time.monotonic()
        ts = [threading.Thread(target=lambda: results.append(load("미국"))) for _ in range(5)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        self.assertLess(time.monotonic() - begin, 1)   # 다운로드가 막혀 있어도 기다리지 않는다
        self.assertEqual(results, ["v1"] * 5)
        self.assertTrue(started.wait(1))
        self.assertEqual(len(calls), 2)                  # 동시 요청에도 갱신은 하나

        release.set()
        _join_refreshes()
        self.assertEqual(load("미국"), "v2")
        self.assertEqual(len(calls), 2)

    def test_갱신이_실패하면_이전_값을_쓰고_잠시_뒤_다시_시도한다(self):
        calls = []

        @stale_while_revalidate(60, retry_after=10)
        def load(market):
            calls.append(market)
            if len(calls) == 2:
                raise RuntimeError("naver down")
            return f"v{len(calls)}"

        load("미국")
        self.clock.now += 61
        self.assertEqual(load("미국"), "v1")
        _join_refreshes()
        self.assertEqual(len(calls), 2)

        self.clock.now += 5
        self.assertEqual(load("미국"), "v1")
        _join_refreshes()
        self.assertEqual(len(calls), 2)                  # 실패 직후 매 요청마다 다시 받지 않는다

        self.clock.now += 6
        self.assertEqual(load("미국"), "v1")
        _join_refreshes()
        self.assertEqual(len(calls), 3)
        self.assertEqual(load("미국"), "v3")

    def test_연달아_실패하면_재시도_간격이_두_배씩_늘어_하루에서_멈춘다(self):
        calls = []

        @stale_while_revalidate(60, retry_after=10)
        def load(market):
            calls.append(market)
            if len(calls) > 1:
                raise RuntimeError("naver down")
            return "v1"

        load("미국")
        self.clock.now += 60
        refreshed_at = []
        for _ in range(200):
            before = len(calls)
            with patch("builtins.print"):
                self.assertEqual(load("미국"), "v1")
                _join_refreshes()
            if len(calls) > before:
                refreshed_at.append(self.clock.now)
            self.clock.now += 1
        gaps = [b - a for a, b in zip(refreshed_at, refreshed_at[1:])]
        self.assertEqual(gaps, [10, 20, 40, 60, 60])     # 10초→20→40→seconds(60)에서 멈춘다

    def test_첫_다운로드_실패는_알리고_다음_요청에서_다시_받는다(self):
        calls = []

        @stale_while_revalidate(60)
        def load(market):
            calls.append(market)
            if len(calls) == 1:
                raise RuntimeError("naver down")
            return "목록"

        with self.assertRaises(RuntimeError):
            load("미국")
        self.assertEqual(load("미국"), "목록")

    def test_덜_받은_갱신은_온전한_이전_값을_덮어쓰지_않는다(self):
        full = pd.DataFrame({"ticker": ["AAPL", "SPY"]})
        stocks_only = pd.DataFrame({"ticker": ["AAPL"]})
        stocks_only.attrs[cache.PARTIAL] = "ETF/US"
        results = [full, stocks_only, full.copy()]
        calls = []

        @stale_while_revalidate(60, retry_after=10)
        def load(market):
            calls.append(market)
            return results[len(calls) - 1]

        self.assertIs(load("미국"), full)
        self.clock.now += 61
        with patch("builtins.print") as log:
            self.assertIs(load("미국"), full)
            _join_refreshes()
        self.assertEqual(len(calls), 2)
        self.assertIn("ETF/US", str(log.call_args))
        self.assertIs(load("미국"), full)              # 실패로 보고 이전 표를 계속 쓴다

        self.clock.now += 5
        load("미국")
        _join_refreshes()
        self.assertEqual(len(calls), 2)                  # 하루가 아니라 retry_after 뒤에 다시 받는다
        self.clock.now += 6
        load("미국")
        _join_refreshes()
        self.assertEqual(len(calls), 3)
        self.assertIs(load("미국"), results[2])

    def test_처음_받은_값이_덜_왔으면_쓰되_곧_다시_받는다(self):
        stocks_only = pd.DataFrame({"ticker": ["AAPL"]})
        stocks_only.attrs[cache.PARTIAL] = "ETF/US"
        full = pd.DataFrame({"ticker": ["AAPL", "SPY"]})
        results = [stocks_only, stocks_only.copy(), full]
        calls = []

        @stale_while_revalidate(60, retry_after=10)
        def load(market):
            calls.append(market)
            return results[len(calls) - 1]

        self.assertIs(load("미국"), stocks_only)          # 콜드 스타트는 주식만이라도 검색되게
        self.clock.now += 11
        load("미국")
        _join_refreshes()
        self.assertIs(load("미국"), results[1])           # 덜 받은 값끼리는 새것으로 바꾼다
        self.clock.now += 11
        load("미국")
        _join_refreshes()
        self.assertEqual(len(calls), 2)                  # 연달아 덜 받으면 간격이 두 배(20초)로 는다
        self.clock.now += 10
        load("미국")
        _join_refreshes()
        self.assertIs(load("미국"), full)
        self.clock.now += 59
        load("미국")
        _join_refreshes()
        self.assertEqual(len(calls), 3)                  # 온전한 값은 정해진 seconds 동안 쓴다

    def test_갱신_실패_로그에_예외_종류가_남는다(self):
        calls = []

        @stale_while_revalidate(60)
        def load(market):
            calls.append(market)
            if len(calls) == 2:
                raise TimeoutError()                     # str()이 빈 문자열인 예외
            return "목록"

        load("미국")
        self.clock.now += 61
        with patch("builtins.print") as log:
            load("미국")
            _join_refreshes()
        self.assertIn("TimeoutError()", str(log.call_args))

    def test_종목검색은_만료된_목록으로_바로_답한다(self):
        release = threading.Event()
        tables = [pd.DataFrame({"ticker": ["AAPL", "APLE"], "name": ["Apple Inc", "Apple Hospitality"]})]

        @stale_while_revalidate(60)
        def load(market):
            if len(tables) > 1:
                release.wait(5)
            tables.append(tables[0])
            return tables[0]

        with patch.object(prices, "cached_symbols", load):
            prices.api_symbols("US", "apple")
            self.clock.now += 61
            begin = time.monotonic()
            out = prices.api_symbols("US", "apple")
            self.assertLess(time.monotonic() - begin, 1)
            release.set()
        self.assertEqual([r["ticker"] for r in out], ["AAPL", "APLE"])

    def test_앱의_종목목록은_이_캐시를_하루_단위로_쓴다(self):
        free = dict(zip(deps.cached_symbols.__code__.co_freevars,
                        (c.cell_contents for c in deps.cached_symbols.__closure__)))
        self.assertIs(deps.cached_symbols.__code__, stale_while_revalidate(1)(len).__code__)
        self.assertIs(free["fn"], S.symbols)
        self.assertEqual(free["seconds"], 60 * 60 * 24)


class 미국_종목목록_다운로드(unittest.TestCase):
    sizes = {_NASDAQ: 250, _NYSE: 120, S._NAVER_US_ETF: 130}

    def test_페이지를_한_번씩만_시간_제한을_두고_받는다(self):
        fake = _FakeNaver(self.sizes)
        with patch.object(S.requests, "get", fake):
            df = S.us_symbols()

        expected = 250 + 120 + 130 - 2                  # ETF의 중복 티커·이름 없는 행 제외
        self.assertEqual(len(df), expected)
        self.assertEqual(list(df.columns), ["ticker", "name"])
        self.assertEqual(df.set_index("ticker").loc["N0", "name"], "N Corp 0")
        self.assertNotIn("E1", set(df["ticker"]))
        pages = sorted((url, page, size) for url, page, size, _ in fake.calls)
        self.assertEqual(pages, sorted(
            [(_NASDAQ, p, 100) for p in (1, 2, 3)] + [(_NYSE, p, 100) for p in (1, 2)]
            + [(S._NAVER_US_ETF, p, 60) for p in (1, 2, 3)]))
        self.assertTrue(all(timeout for *_, timeout in fake.calls))
        self.assertNotIn(cache.PARTIAL, df.attrs)

    def test_클래스_주식_코드는_대시로_바꾸고_영문명이_없으면_한글명을_쓴다(self):
        class Fake(_FakeNaver):
            def rows(self, url):
                rows = super().rows(url)
                if url == _NYSE:
                    rows[0] = {"symbolCode": "BRK B", "stockNameEng": "Berkshire Hathaway Inc Class B"}
                    rows[1] = {"symbolCode": "Y1", "stockNameEng": None, "stockName": "와이원"}
                    rows[2] = {"symbolCode": " ", "stockNameEng": "코드 없음"}
                return rows

        with patch.object(S.requests, "get", Fake(self.sizes)):
            df = S.us_symbols().set_index("ticker")["name"]
        self.assertEqual(df["BRK-B"], "Berkshire Hathaway Inc Class B")
        self.assertNotIn("BRK B", df.index)
        self.assertEqual(df["Y1"], "와이원")
        self.assertFalse(df.index.str.contains(" ").any())
        self.assertEqual(len(df), 250 + 120 + 130 - 2 - 1)

    def test_페이지가_요청보다_작게_오면_잘린_목록을_만들지_않는다(self):
        class Capped(_FakeNaver):
            def __call__(self, url, params=None, headers=None, timeout=None):
                # 네이버가 400 없이 pageSize를 60으로 줄여 준다고 가정
                return super().__call__(url, {**params, "pageSize": min(60, params["pageSize"])},
                                        headers, timeout)

        with patch.object(S.requests, "get", Capped(self.sizes)):
            with self.assertRaisesRegex(ValueError, "잘렸습니다"):
                S.us_symbols()

    def test_순간_오류는_한_번_더_시도한다(self):
        failed = []

        def flaky(url, page):
            if url == _NASDAQ and page == 2 and not failed:
                failed.append(page)
                raise requests.ConnectionError("reset")

        with patch.object(S.requests, "get", _FakeNaver(self.sizes, flaky)):
            df = S.us_symbols()
        self.assertIn("N150", set(df["ticker"]))

    def test_주식_페이지가_계속_실패하면_불완전한_목록을_만들지_않는다(self):
        def broken(url, page):
            if url == _NYSE and page == 2:
                raise requests.ConnectionError("reset")

        with patch.object(S.requests, "get", _FakeNaver(self.sizes, broken)):
            with self.assertRaises(requests.ConnectionError):
                S.us_symbols()

    def test_ETF가_실패해도_주식은_검색된다(self):
        def no_etf(url, page):
            if url == S._NAVER_US_ETF:
                raise requests.ConnectionError("reset")

        with patch.object(S.requests, "get", _FakeNaver(self.sizes, no_etf)):
            df = S.us_symbols()
        self.assertEqual(len(df), 250 + 120)
        self.assertEqual(df.attrs[cache.PARTIAL], "ETF/US")   # 캐시가 온전한 표를 이걸로 바꾸지 않게

    def test_ETF가_시간_안에_안_오면_주식만_덜_받은_표로_돌려준다(self):
        release = threading.Event()
        self.addCleanup(release.set)

        def slow_etf(url, page):
            if url == S._NAVER_US_ETF and page == 2:
                release.wait(5)

        with patch.object(S, "_US_DEADLINE", 0.5), \
                patch.object(S.requests, "get", _FakeNaver(self.sizes, slow_etf)), \
                patch("builtins.print") as log:
            df = S.us_symbols()
        self.assertEqual(len(df), 250 + 120)
        self.assertEqual(df.attrs[cache.PARTIAL], "ETF/US")
        self.assertIn("TimeoutError()", str(log.call_args))

    def test_응답이_멈춰도_정해진_시간_안에_포기한다(self):
        release = threading.Event()
        self.addCleanup(release.set)

        def hang(url, page):
            if url == _NYSE and page == 2:
                release.wait(5)

        with patch.object(S, "_US_DEADLINE", 0.3), \
                patch.object(S.requests, "get", _FakeNaver(self.sizes, hang)):
            begin = time.monotonic()
            with self.assertRaises(TimeoutError):
                S.us_symbols()
        self.assertLess(time.monotonic() - begin, 2)

    def test_빈_목록은_저장하지_않도록_실패로_알린다(self):
        with patch.object(S.requests, "get", _FakeNaver({**self.sizes, _NASDAQ: 0})):
            with self.assertRaises(ValueError):
                S.us_symbols()

    def test_국내_목록은_기존_FDR_경로를_그대로_쓴다(self):
        listings = {"KRX": pd.DataFrame({"Code": ["5930"], "Name": ["삼성전자"]}),
                    "ETF/KR": pd.DataFrame({"Symbol": ["069500"], "Name": ["KODEX 200"]})}
        with patch.object(S.fdr, "StockListing", side_effect=listings.__getitem__), \
                patch.object(S.requests, "get", side_effect=AssertionError("국내는 직접 호출하지 않는다")):
            df = S.symbols("한국")
        self.assertEqual(df.to_dict("records"), [{"ticker": "005930", "name": "삼성전자"},
                                                 {"ticker": "069500", "name": "KODEX 200"}])
        self.assertNotIn(cache.PARTIAL, df.attrs)

    def test_국내_ETF가_실패하면_덜_받은_표로_표시한다(self):
        def listing(market):
            if market == "ETF/KR":
                raise ConnectionError("reset")
            return pd.DataFrame({"Code": ["5930"], "Name": ["삼성전자"]})

        with patch.object(S.fdr, "StockListing", side_effect=listing), patch("builtins.print"):
            df = S.symbols("한국")
        self.assertEqual(list(df["ticker"]), ["005930"])
        self.assertEqual(df.attrs[cache.PARTIAL], "ETF/KR")


if __name__ == "__main__":
    unittest.main()
