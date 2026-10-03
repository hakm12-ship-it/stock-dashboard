"""Transient Yahoo failures recover without a restart; no live finance IO."""

import unittest
from unittest.mock import Mock, PropertyMock, patch

import pandas as pd
import analysis.fundamental as F
from deps import cached_valuation


class FundamentalCacheTests(unittest.TestCase):
    def setUp(self):
        F._resolve_cache.clear()
        F._valuation_cache.clear()

    def ticker(self, info):
        ticker = Mock()
        ticker.info = info
        ticker.balance_sheet = pd.DataFrame()
        return ticker

    def test_failure_is_retried_after_two_minutes_through_public_wrapper(self):
        failed = self.ticker({})
        type(failed).info = PropertyMock(side_effect=RuntimeError("429"))
        ready = self.ticker({"trailingPE": 25, "priceToBook": 3})
        with patch.object(F.yf, "Ticker", side_effect=[failed, ready]) as factory:
            with patch.object(F.time, "monotonic", return_value=100):
                self.assertIsNone(cached_valuation("미국", "AAPL")["PER"])
            with patch.object(F.time, "monotonic", return_value=219):
                self.assertIsNone(cached_valuation("미국", "AAPL")["PER"])
            self.assertEqual(factory.call_count, 1)
            with patch.object(F.time, "monotonic", return_value=220):
                self.assertEqual(cached_valuation("미국", "AAPL")["PER"], 25)
            self.assertEqual(factory.call_count, 2)

    def test_success_refreshes_after_one_hour(self):
        with patch.object(F.yf, "Ticker", side_effect=[self.ticker({"trailingPE": 10, "priceToBook": 2}),
                                                      self.ticker({"trailingPE": 20, "priceToBook": 3})]) as factory:
            with patch.object(F.time, "monotonic", return_value=100):
                self.assertEqual(F.cached_valuation("미국", "AAPL")["PER"], 10)
            with patch.object(F.time, "monotonic", return_value=3699):
                self.assertEqual(F.cached_valuation("미국", "AAPL")["PER"], 10)
            self.assertEqual(factory.call_count, 1)
            with patch.object(F.time, "monotonic", return_value=3700):
                self.assertEqual(F.cached_valuation("미국", "AAPL")["PER"], 20)
            self.assertEqual(factory.call_count, 2)

    def test_domestic_success_uses_same_bounded_cache(self):
        info = {"name": "test", "per": 10, "pbr": 2, "eps": 5, "roe": 0.1,
                "divYield": 1, "marketCap": 1000}
        with patch.object(F, "naver_fundamentals", return_value=info) as fetch:
            first = F.cached_valuation("한국", "005930")
            second = F.cached_valuation("한국", "005930")
        self.assertEqual(first, second)
        fetch.assert_called_once()


if __name__ == "__main__":
    unittest.main()
