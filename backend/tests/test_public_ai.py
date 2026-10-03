"""Public AI budgets and cooldowns; never contacts a model."""

from concurrent.futures import ThreadPoolExecutor
import os
import threading
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError

from services import public_ai as B


def reset_budget():
    with B._guard:
        B._cache.clear()
        B._failures.clear()
        B._inflight.clear()
        B._day = ""
        B._attempts = 0
        B._cooldown_until = 0


class PublicAIBudgetTests(unittest.TestCase):
    def setUp(self):
        reset_budget()
        self.env = patch.dict(os.environ, {"GEMINI_API_KEY": "mock", "PUBLIC_AI_DAILY_LIMIT": "20"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_cached_result_is_a_copy_and_does_not_spend_again(self):
        create = Mock(return_value={"summary": "first"})
        first = B.generate("briefing", "KR:005930", create, ttl=3600)
        first["summary"] = "modified"
        second = B.generate("briefing", "KR:005930", create, ttl=3600)
        self.assertEqual(second["summary"], "first")
        self.assertEqual(B._attempts, 1)
        create.assert_called_once()

    def test_one_budget_is_shared_across_all_public_ai_panels(self):
        with patch.dict(os.environ, {"PUBLIC_AI_DAILY_LIMIT": "2"}):
            B.generate("briefing", "AAPL", lambda: "a", ttl=60)
            B.generate("portfolio", "holding-key", lambda: "b", ttl=60)
            with self.assertRaises(B.AIUnavailable) as raised:
                B.generate("related", "NVDA", lambda: "c", ttl=60)
        self.assertEqual(raised.exception.reason, "daily_limit")
        self.assertEqual(B._attempts, 2)

    def test_quota_failure_stops_other_keys_and_other_panels(self):
        create = Mock(side_effect=HTTPError("https://mock.invalid/secret", 429, "quota", {"Retry-After": "1200"}, None))
        with patch.object(B.time, "monotonic", return_value=100):
            with self.assertRaises(B.AIUnavailable):
                B.generate("briefing", "AAPL", create, ttl=60)
        with patch.object(B.time, "monotonic", return_value=1299):
            for kind, identity in (("briefing", "AAPL"), ("portfolio", "different")):
                with self.assertRaises(B.AIUnavailable) as raised:
                    B.generate(kind, identity, create, ttl=60)
                self.assertEqual(raised.exception.reason, "quota_cooldown")
        create.assert_called_once()
        with patch.object(B.time, "monotonic", return_value=1300):
            self.assertEqual(B.generate("briefing", "AAPL", lambda: "recovered", ttl=60), "recovered")

    def test_timeout_is_cached_for_two_minutes_without_exposing_error(self):
        create = Mock(side_effect=TimeoutError("api-secret"))
        with patch.object(B.time, "monotonic", return_value=100):
            for _ in range(4):
                with self.assertRaises(B.AIUnavailable) as raised:
                    B.generate("briefing", "AAPL", create, ttl=60)
                self.assertNotIn("api-secret", str(raised.exception))
        create.assert_called_once()
        self.assertEqual(B._attempts, 1)

    def test_inflight_generation_is_not_duplicated_or_parallelized(self):
        entered, finish = threading.Event(), threading.Event()

        def create():
            entered.set()
            self.assertTrue(finish.wait(3))
            return "done"

        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(B.generate, "briefing", "AAPL", create, ttl=60)
            self.assertTrue(entered.wait(2))
            try:
                for kind, identity in (("briefing", "AAPL"), ("related", "NVDA")):
                    with self.assertRaises(B.AIUnavailable) as raised:
                        B.generate(kind, identity, create, ttl=60)
                    self.assertEqual(raised.exception.reason, "busy")
            finally:
                finish.set()
            self.assertEqual(first.result(timeout=3), "done")
        self.assertEqual(B._attempts, 1)

    def test_kst_date_change_resets_budget(self):
        with patch.dict(os.environ, {"PUBLIC_AI_DAILY_LIMIT": "1"}):
            with patch.object(B, "_today", return_value="2026-10-04"):
                B.generate("briefing", "AAPL", lambda: "first", ttl=60)
            with patch.object(B, "_today", return_value="2026-10-05"):
                self.assertEqual(B.generate("briefing", "MSFT", lambda: "next", ttl=60), "next")
        self.assertEqual(B._attempts, 1)

    def test_kst_midnight_does_not_cancel_active_quota_cooldown(self):
        create = Mock(side_effect=HTTPError("https://mock.invalid", 429, "quota", {}, None))
        with patch.object(B.time, "monotonic", return_value=100), patch.object(B, "_today", return_value="2026-10-04"):
            with self.assertRaises(B.AIUnavailable):
                B.generate("briefing", "AAPL", create, ttl=60)
        with patch.object(B.time, "monotonic", return_value=101), patch.object(B, "_today", return_value="2026-10-05"):
            with self.assertRaises(B.AIUnavailable) as raised:
                B.generate("portfolio", "next-day", create, ttl=60)
        self.assertEqual(raised.exception.reason, "quota_cooldown")
        create.assert_called_once()

    def test_unconfigured_or_zero_budget_never_runs_callback(self):
        create = Mock()
        for settings in ({"GEMINI_API_KEY": ""}, {"PUBLIC_AI_DAILY_LIMIT": "0"}):
            with patch.dict(os.environ, settings), self.assertRaises(B.AIUnavailable):
                B.generate("briefing", "AAPL", create, ttl=60)
        create.assert_not_called()

    def test_expired_entry_refreshes_once(self):
        create = Mock(side_effect=["old", "new"])
        with patch.object(B.time, "monotonic", return_value=100):
            B.generate("briefing", "AAPL", create, ttl=60)
        with patch.object(B.time, "monotonic", return_value=159):
            self.assertEqual(B.generate("briefing", "AAPL", create, ttl=60), "old")
        with patch.object(B.time, "monotonic", return_value=160):
            self.assertEqual(B.generate("briefing", "AAPL", create, ttl=60), "new")
        self.assertEqual(create.call_count, 2)


if __name__ == "__main__":
    unittest.main()
