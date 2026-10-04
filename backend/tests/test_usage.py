import json
import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from fastapi import FastAPI
from fastapi.testclient import TestClient
from cache import ttl_cache
from routers.usage import router
from services import public_ai as B, usage as U

class UsageTests(unittest.TestCase):
    def setUp(self):
        with U._guard:
            U._day = ""
        with B._guard:
            B._cache.clear(); B._failures.clear(); B._inflight.clear()
            B._day = ""; B._attempts = 0; B._cooldown_until = 0; B._metric_day = ""
        self.env = patch.dict(os.environ, {"GEMINI_API_KEY": "secret-key", "PUBLIC_AI_DAILY_LIMIT": "2"})
        self.env.start(); self.addCleanup(self.env.stop)

    def test_cache_counts_actual_reuse_and_failed_loads(self):
        @ttl_cache(60)
        def cached(value):
            if value == "bad": raise ValueError("secret-account")
            return value
        cached("a"); cached("a")
        with self.assertRaises(ValueError): cached("bad")
        result = U.snapshot()
        self.assertEqual((result["cacheHits"], result["cacheLoads"], result["cacheErrors"]), (1, 2, 1))
        self.assertEqual(result["cacheHitRate"], 33.3)
        self.assertNotIn("secret-account", json.dumps(result))

    def test_request_counters_are_thread_safe_bounded_and_ignore_private_urls(self):
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(lambda _: U.record_request("/api/prices", 200), range(100)))
        for _ in range(9): U.record_request("/api/news", 503)
        for path in ["/api/usage-status", "/api/private/secret", "/api/prices?token=secret"]: U.record_request(path, 500)
        result = U.snapshot()
        self.assertEqual(result["requests"], 109)
        self.assertEqual(result["httpErrors"], 9)
        self.assertEqual(len(result["recentErrors"]), 5)
        self.assertNotIn("secret", json.dumps(result))

    def test_korean_date_rollover_clears_daily_aggregates(self):
        with patch.object(U, "_today", return_value="2026-10-04"):
            U.record_request("/api/prices", 200)
            self.assertEqual(U.snapshot()["requests"], 1)
        with patch.object(U, "_today", return_value="2026-10-05"):
            self.assertEqual(U.snapshot()["requests"], 0)

    def test_ai_read_only_snapshot_counts_reuse_and_omits_identities_and_secrets(self):
        create = Mock(return_value="ok")
        B.generate("portfolio", "secret-holdings", create, ttl=60)
        B.cached("portfolio", "secret-holdings")
        B.generate("portfolio", "secret-holdings", create, ttl=60)
        result = B.usage_snapshot()
        self.assertEqual((result["attempts"], result["remaining"], result["cacheHits"]), (1, 1, 2))
        self.assertNotIn("secret", json.dumps(result))
        create.assert_called_once()

    def test_ai_failures_show_safe_reason_and_remaining_budget_after_rollover(self):
        with patch.object(B, "_today", return_value="2026-10-04"):
            with self.assertRaises(B.AIUnavailable):
                B.generate("briefing", "secret-ticker", Mock(side_effect=HTTPError("secret-url", 429, "secret-body", {}, None)), ttl=60)
            result = B.usage_snapshot()
            self.assertEqual(result["recentErrors"][0]["reason"], "quota_cooldown")
            self.assertEqual(result["attempts"], 1)
            self.assertNotIn("secret", json.dumps(result))
        with patch.object(B, "_today", return_value="2026-10-05"):
            result = B.usage_snapshot()
            self.assertEqual((result["attempts"], result["remaining"], result["recentErrors"]), (0, 2, []))

    def test_status_route_never_generates_ai_or_counts_its_own_request(self):
        app = FastAPI(); app.include_router(router)
        with patch.object(B, "generate", side_effect=AssertionError("must not generate")):
            response = TestClient(app).get("/api/usage-status")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(response.json()["scope"], "server_process")
        self.assertTrue(response.json()["ai"]["resetsOnRestart"])
