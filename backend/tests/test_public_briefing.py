"""Public RSS snapshots: no AI, no send, bounded IO, and honest slot archives."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import os
import threading
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import data.public_briefing as B
import data.market_digest as private_digest
import routers.public_briefing as R
import services.notifications as notifications

NOW = datetime(2026, 10, 4, 12, 1, tzinfo=B.KST)


def article(identifier="one", title="국내 증시 주요 소식", at=NOW, source="한국경제", market="KR"):
    return {"id": identifier, "title": title, "source": source, "_market": market,
            "url": f"https://example.com/news/{identifier}", "publishedAt": at.isoformat()}


class PublicBriefingTests(unittest.TestCase):
    def setUp(self):
        B._cache.clear()
        self.env = patch.dict(os.environ, {"GEMINI_API_KEY": "must-not-be-used"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.collect_patch = patch.object(B, "_collect_sources", return_value=(
            [article()], [{"name": "한국경제", "status": "ok"}],
        ))
        self.collect = self.collect_patch.start()
        self.addCleanup(self.collect_patch.stop)
        self.forbidden = []
        for target, attribute in ((private_digest, "_ask"), (private_digest, "build_digest"),
                                  (notifications, "send_telegram_message")):
            guard = patch.object(target, attribute, side_effect=AssertionError("paid/send path called"))
            self.forbidden.append(guard.start())
            self.addCleanup(guard.stop)

    def tearDown(self):
        for guard in self.forbidden:
            guard.assert_not_called()

    def test_current_slot_collects_only_headlines_with_provenance(self):
        result = B.get_public_briefing("noon", now=NOW)
        self.assertTrue(result["available"])
        self.assertEqual(result["mode"], "rss_headlines")
        self.assertEqual(result["windowStart"], "2026-10-04T07:00:00+09:00")
        self.assertEqual(result["windowEnd"], NOW.isoformat())
        self.assertEqual(result["generatedAt"], NOW.isoformat())
        self.assertEqual(result["items"][0]["publishedAt"], NOW.isoformat())
        self.assertEqual(result["items"][0]["url"], "https://example.com/news/one")
        self.assertNotIn("summary", result["items"][0])

    def test_morning_window_begins_previous_evening(self):
        morning = NOW.replace(hour=7)
        self.collect.return_value = ([article(at=morning - timedelta(hours=1))], [])
        result = B.get_public_briefing("morning", now=morning.astimezone(timezone.utc))
        self.assertEqual(result["windowStart"], "2026-10-03T18:00:00+09:00")
        self.assertEqual(result["date"], "2026-10-04")

    def test_future_slot_never_fetches_or_claims_collection_time(self):
        result = B.get_public_briefing("evening", now=NOW)
        self.assertEqual(result["status"], "not_started")
        self.assertIsNone(result["generatedAt"])
        self.assertIsNone(result["windowEnd"])
        self.collect.assert_not_called()

    def test_missing_prior_slot_and_yesterday_are_not_recreated_from_new_news(self):
        for day, slot in ((NOW.date(), "morning"), ((NOW - timedelta(days=1)).date(), "evening")):
            result = B.get_public_briefing(slot, day, now=NOW)
            self.assertEqual(result["status"], "archive_unavailable")
            self.assertIsNone(result["generatedAt"])
        self.collect.assert_not_called()

    def test_existing_snapshot_is_reused_as_archive_without_rewriting_time(self):
        first = B.get_public_briefing("noon", now=NOW)
        later = B.get_public_briefing("noon", now=NOW.replace(hour=19))
        self.assertEqual(first, later)
        self.collect.assert_called_once()

    def test_repeat_visits_reuse_one_shared_copy(self):
        first = B.get_public_briefing("noon", now=NOW)
        first["items"].clear()
        second = B.get_public_briefing("noon", now=NOW + timedelta(minutes=20))
        self.assertEqual(len(second["items"]), 1)
        self.assertEqual(second["generatedAt"], NOW.isoformat())
        self.collect.assert_called_once()

    def test_old_future_and_duplicate_news_are_excluded(self):
        self.collect.return_value = ([
            article(), article("duplicate", "국내 증시 주요 소식", source="다른매체"),
            article("future", "내일 발표", NOW + timedelta(seconds=1)),
            article("old", "오래된 기사", NOW - timedelta(hours=24, seconds=1)),
        ], [])
        result = B.get_public_briefing("noon", now=NOW)
        self.assertEqual([row["id"] for row in result["items"]], ["one"])

    def test_at_most_seven_items_with_domestic_foreign_and_publisher_diversity(self):
        titles = ["금리 동결 발표", "반도체 수출 회복", "물가 지표 집계", "고용 동향 변화", "기업 실적 증가", "관세 협의 결과", "나스닥 장중 동향", "유가 공급 전망"]
        self.collect.return_value = ([article(str(i), title, source=f"매체{i // 2}", market="KR" if i < 4 else "US")
                                      for i, title in enumerate(titles)], [])
        result = B.get_public_briefing("noon", now=NOW)
        self.assertEqual(len(result["items"]), 7)
        self.assertTrue(any(row["id"] in {"4", "5", "6", "7"} for row in result["items"]))
        self.assertLessEqual(sum(row["source"] == "매체0" for row in result["items"]), 2)

    def test_older_backfill_is_explicit_and_keeps_original_publication_time(self):
        old = article("old", "미국 고용 발표", NOW - timedelta(hours=10), "CNBC", "US")
        self.collect.return_value = ([article(), old], [])
        result = B.get_public_briefing("noon", now=NOW)
        self.assertEqual(result["backfillCount"], 1)
        row = next(item for item in result["items"] if item["id"] == "old")
        self.assertTrue(row["previousWindow"])
        self.assertEqual(row["publishedAt"], old["publishedAt"])

    def test_partial_source_failure_is_visible_alongside_usable_news(self):
        self.collect.return_value = ([article()], [{"name": "한국경제", "status": "ok"}, {"name": "CNBC", "status": "error"}])
        result = B.get_public_briefing("noon", now=NOW)
        self.assertTrue(result["available"])
        self.assertEqual(result["sources"][1]["status"], "error")

    def test_failures_have_ten_minute_cooldown_and_recover_only_in_current_slot(self):
        self.collect.return_value = ([], [{"name": "CNBC", "status": "error"}])
        with patch.object(B.time, "monotonic", return_value=100):
            first = B.get_public_briefing("noon", now=NOW)
        with patch.object(B.time, "monotonic", return_value=699):
            again = B.get_public_briefing("noon", now=NOW + timedelta(minutes=5))
        self.assertFalse(first["available"])
        self.assertEqual(again["retryAfter"], 1)
        self.collect.assert_called_once()
        self.collect.return_value = ([article()], [])
        with patch.object(B.time, "monotonic", return_value=700):
            recovered = B.get_public_briefing("noon", now=NOW + timedelta(minutes=10))
        self.assertTrue(recovered["available"])
        self.assertEqual(self.collect.call_count, 2)

    def test_singleflight_prevents_other_visitors_from_starting_another_collection(self):
        started, release = threading.Event(), threading.Event()
        def slow():
            started.set()
            self.assertTrue(release.wait(timeout=3))
            return [article()], []
        self.collect.side_effect = slow
        with ThreadPoolExecutor(max_workers=1) as pool:
            first = pool.submit(B.get_public_briefing, "noon", now=NOW)
            self.assertTrue(started.wait(timeout=2))
            try:
                self.assertEqual(B.get_public_briefing("noon", now=NOW)["status"], "building")
            finally:
                release.set()
            self.assertTrue(first.result(timeout=3)["available"])
        self.collect.assert_called_once()

    def test_dates_and_slots_are_bounded_before_collection(self):
        for slot, day in (("other", NOW.date()), ("noon", (NOW + timedelta(days=1)).date()),
                          ("noon", (NOW - timedelta(days=7)).date())):
            with self.assertRaises(ValueError):
                B.get_public_briefing(slot, day, now=NOW)
        self.collect.assert_not_called()

    def test_cache_retains_at_most_seven_days_and_twenty_one_slots(self):
        for day_offset in range(10):
            for slot, (hour, _) in B.SLOTS.items():
                at = (NOW + timedelta(days=day_offset)).replace(hour=hour)
                self.collect.return_value = ([article(at=at)], [])
                B.get_public_briefing(slot, now=at)
        self.assertEqual(len(B._cache), B.MAX_CACHE_ENTRIES)

    def test_public_http_route_needs_no_admin_and_rejects_invalid_queries(self):
        app = FastAPI()
        app.include_router(R.router)
        client = TestClient(app)
        with patch.object(R, "get_public_briefing", side_effect=lambda slot, day: B.get_public_briefing(slot, day, now=NOW)):
            response = client.get("/api/public-briefing", params={"date": "2026-10-04", "slot": "noon"})
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()["available"])
            self.assertIn("max-age=60", response.headers["Cache-Control"])
            for params in ({"slot": "invalid"}, {"date": "bad"}, {"date": "2026-10-05"}):
                self.assertEqual(client.get("/api/public-briefing", params=params).status_code, 422)


class PublicSourceCollectionTests(unittest.TestCase):
    def test_same_publisher_mixed_feeds_are_reported_partial_and_workers_bounded(self):
        feeds = (("한국경제", "KR", "good"), ("한국경제", "KR", "bad"), ("CNBC", "US", "other"))
        def fetch(feed):
            if feed[2] == "bad":
                raise TimeoutError("must-not-leak")
            return [article(identifier=feed[2])]
        with patch.object(B, "_FEEDS", feeds), patch.object(B, "_fetch_feed", side_effect=fetch), \
                patch.object(B, "ThreadPoolExecutor", wraps=ThreadPoolExecutor) as pool:
            articles, sources = B._collect_sources()
        self.assertEqual(len(articles), 2)
        self.assertEqual(sources, [{"name": "한국경제", "status": "partial"}, {"name": "CNBC", "status": "ok"}])
        pool.assert_called_once_with(max_workers=3)


if __name__ == "__main__":
    unittest.main()
