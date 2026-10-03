"""Scheduled delivery tests; all market providers and Telegram sends are mocked."""

import importlib
import os
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import services.notifications as N
from routers import calendar as C

MORNING = datetime(2026, 10, 5, 7, 0, tzinfo=N.KST)


def calendar(events=None, sources=None):
    return {
        "events": events or [],
        "sources": sources if sources is not None else [{"name": "official", "status": "ok"}],
        "timezone": "Asia/Seoul",
    }


def event(at, **values):
    return {
        "id": "event-1", "title": "중요 경제지표", "category": "economic", "country": "US",
        "startAt": at.isoformat(), "date": at.astimezone(N.KST).date().isoformat(),
        "timeStatus": "confirmed", "importance": "high", "source": "공식 기관",
        **values,
    }


class NotificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "notifications.sqlite3"
        self.env = patch.dict(os.environ, {
            "TELEGRAM_BOT_TOKEN": "secret-token", "TELEGRAM_BRIEFING_CHAT_ID": "-10012345",
            "TELEGRAM_ANNOUNCE_CHAT_ID": "-10099999", "TELEGRAM_CHAT_ID": "999,888",
            "NOTIFICATION_STATE_PATH": str(self.path), "NOTIFICATIONS_ENABLED": "true",
            "NOTIFICATION_SCHEDULER_ACTIVE": "", "ALERT_CHECK_KEY": "scheduler-secret",
        })
        self.env.start()
        self.send = patch.object(N, "send_telegram_message", return_value=True).start()
        self.digest = patch.object(N, "build_digest", return_value={"available": True, "text": "아침 시황"}).start()
        self.cal = patch.object(N, "get_calendar", return_value=calendar()).start()

    def tearDown(self):
        patch.stopall()
        self.env.stop()
        self.temp.cleanup()

    def check(self, now=MORNING, dry_run=False):
        return N.check_notifications(now=now, dry_run=dry_run)

    def test_default_is_preview_and_has_no_side_effects(self):
        result = N.check_notifications(now=MORNING)
        self.assertTrue(result["dryRun"])
        self.assertEqual(result["jobs"][0]["status"], "preview")
        self.assertFalse(self.path.exists())
        self.send.assert_not_called()

    def test_same_briefing_is_sent_once_across_polling_and_restart(self):
        self.assertEqual(self.check()["jobs"][0]["status"], "sent")
        self.assertEqual(self.check(now=MORNING + timedelta(minutes=5))["jobs"][0]["status"], "already_claimed")
        # A newly imported module has no process-local memory from the first run.
        spec = importlib.util.spec_from_file_location("services.notifications_restart", N.__file__)
        restarted = importlib.util.module_from_spec(spec)
        import sys
        sys.modules[spec.name] = restarted
        try:
            spec.loader.exec_module(restarted)
            with patch.object(restarted, "build_digest", self.digest), \
                 patch.object(restarted, "get_calendar", self.cal), \
                 patch.object(restarted, "send_telegram_message", self.send):
                result = restarted.check_notifications(now=MORNING, dry_run=False)
            self.assertEqual(result["jobs"][0]["status"], "already_claimed")
        finally:
            sys.modules.pop(spec.name, None)
        self.send.assert_called_once_with("-10012345", "아침 시황")

    def test_concurrent_workers_claim_only_once(self):
        with ThreadPoolExecutor(max_workers=5) as pool:
            results = list(pool.map(lambda _: self.check(), range(5)))
        self.send.assert_called_once()
        self.assertEqual(sum(r["jobs"][0]["status"] == "sent" for r in results), 1)

    def test_delivery_uncertainty_is_not_retried(self):
        self.send.return_value = False
        self.assertEqual(self.check()["jobs"][0]["status"], "delivery_unknown")
        self.assertEqual(self.check()["jobs"][0]["status"], "already_claimed")
        self.send.assert_called_once()

    def test_exception_during_send_is_not_retried_or_logged_with_secret(self):
        self.send.side_effect = TimeoutError("https://api.telegram.org/botsecret-token/sendMessage")
        with self.assertLogs(N.logger, level="WARNING") as logs:
            self.check()
        self.check()
        self.assertNotIn("secret-token", " ".join(logs.output))
        self.send.assert_called_once()

    def test_claim_survives_crash_before_delivery(self):
        jobs, _ = N._plan(MORNING, "-10012345")
        self.assertTrue(N._claim(self.path, jobs[0], MORNING))
        self.assertEqual(self.check()["jobs"][0]["status"], "already_claimed")
        self.send.assert_not_called()

    def test_provider_failure_is_retryable_without_ledger_claim(self):
        self.digest.return_value = {"available": False, "text": ""}
        self.assertEqual(self.check()["jobs"], [])
        self.assertFalse(self.path.exists())
        self.digest.return_value = {"available": True, "text": "복구된 시황"}
        self.assertEqual(self.check()["jobs"][0]["status"], "sent")

    def test_each_slot_and_date_are_distinct(self):
        for instant in [MORNING, MORNING.replace(hour=12), MORNING + timedelta(days=1)]:
            self.check(now=instant)
        self.assertEqual(self.send.call_count, 3)

    def test_poll_does_not_send_expired_briefings(self):
        for minute in [10, 30, 59]:
            self.assertEqual(self.check(now=MORNING.replace(minute=minute))["jobs"], [])
        self.send.assert_not_called()

    def test_only_confirmed_high_events_receive_hour_reminder(self):
        now = MORNING.replace(hour=14)
        when = now + timedelta(hours=1)
        self.cal.return_value = calendar([
            event(when), event(when, id="tentative", timeStatus="tentative"),
            event(when, id="date_only", timeStatus="date_only", startAt=None),
            event(when, id="medium", importance="medium"),
            event(when, id="naive", startAt=when.replace(tzinfo=None).isoformat()),
            event(when + timedelta(minutes=1), id="too_early"),
            event(when - timedelta(minutes=10), id="too_late"),
        ])
        result = self.check(now=now)
        self.assertEqual([job["kind"] for job in result["jobs"]], ["event_reminder"])
        self.cal.return_value = calendar([event(when)])
        self.check(now=now + timedelta(minutes=5))
        self.send.assert_called_once()

    def test_reminders_cross_kst_midnight_and_canonicalize_utc(self):
        now = MORNING.replace(hour=23, minute=30)
        when = now + timedelta(hours=1)
        self.cal.return_value = calendar([event(when)])
        self.check(now=now)
        self.cal.assert_called_with(now.date(), now.date() + timedelta(days=1))
        self.cal.return_value = calendar([event(when.astimezone(timezone.utc))])
        self.check(now=now)
        self.send.assert_called_once()

    def test_evening_includes_tomorrow_summary_and_no_fake_exact_time(self):
        evening = MORNING.replace(hour=18)
        when = (evening + timedelta(days=1)).replace(hour=9)
        self.cal.return_value = calendar([event(when, timeStatus="date_only", startAt=None)])
        result = self.check(now=evening)
        self.assertEqual([job["kind"] for job in result["jobs"]], ["briefing", "tomorrow_calendar"])
        self.assertIn("시간 미정", self.send.call_args_list[1].args[1])
        self.check(now=evening)
        self.assertEqual(self.send.call_count, 2)

    def test_failed_calendar_is_not_reported_as_empty(self):
        self.cal.return_value = calendar(sources=[{"name": "official", "status": "error"}])
        result = self.check(now=MORNING.replace(hour=18))
        self.assertEqual([job["kind"] for job in result["jobs"]], ["briefing"])
        self.assertIn("tomorrow_calendar:data_unavailable", result["skipped"])

    def test_tomorrow_preserves_us_local_date_and_tentative_time(self):
        evening = MORNING.replace(hour=18)
        when = (evening + timedelta(days=1)).replace(hour=3)
        self.cal.return_value = calendar([
            event(when, id="earnings", category="earnings", startAt=None, timeStatus="tentative"),
            event(when, id="fomc", timeStatus="tentative"),
        ])
        self.check(now=evening)
        text = self.send.call_args_list[1].args[1]
        self.assertIn("예상 · 시간 미정 · 미국 현지 날짜 2026-10-06", text)
        self.assertIn("예상 · 03:00 한국시간", text)
        self.assertNotIn("(한국시간)", text)

    def test_missing_state_and_private_fallback_do_not_send(self):
        with patch.dict(os.environ, {"NOTIFICATION_STATE_PATH": ""}):
            self.assertFalse(self.check()["checked"])
        with patch.dict(os.environ, {"TELEGRAM_BRIEFING_CHAT_ID": "", "TELEGRAM_ANNOUNCE_CHAT_ID": ""}):
            self.assertFalse(self.check()["checked"])
        with patch.dict(os.environ, {"TELEGRAM_BRIEFING_CHAT_ID": "1,2"}):
            self.assertFalse(self.check()["checked"])
        with patch.dict(os.environ, {"NOTIFICATION_STATE_PATH": ":memory:"}):
            self.assertFalse(self.check()["checked"])
        self.send.assert_not_called()
        self.cal.assert_not_called()

    def test_announce_fallback_only_targets_the_explicit_room(self):
        with patch.dict(os.environ, {"TELEGRAM_BRIEFING_CHAT_ID": ""}):
            self.check()
        self.send.assert_called_once_with("-10099999", "아침 시황")

    def test_disabled_and_unwritable_ledger_fail_closed(self):
        with patch.dict(os.environ, {"NOTIFICATIONS_ENABLED": "false"}):
            self.assertFalse(self.check()["checked"])
        with patch.object(N, "_claim", side_effect=sqlite3.OperationalError("not writable")):
            self.assertEqual(self.check()["jobs"][0]["status"], "state_unavailable")
        self.send.assert_not_called()

    def test_status_is_secret_free_and_scheduler_must_be_explicitly_active(self):
        status = N.notification_status()
        self.assertTrue(status["configured"])
        self.assertFalse(status["schedulerActive"])
        for private in ["secret-token", "-10012345", str(self.path), "scheduler-secret"]:
            self.assertNotIn(private, str(status))
        with patch.dict(os.environ, {"NOTIFICATION_SCHEDULER_ACTIVE": "true"}):
            self.assertTrue(N.notification_status()["schedulerActive"])

    def test_long_messages_fit_telegram_limit_even_with_emoji(self):
        self.digest.return_value = {"available": True, "text": "📈" * 5000}
        self.check()
        message = self.send.call_args.args[1]
        self.assertLess(len(message.encode("utf-16-le")) // 2, 4096)


class CalendarRouteTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(C.router)
        self.client = TestClient(app)
        self.env = patch.dict(os.environ, {"ALERT_CHECK_KEY": "scheduler-secret"})
        self.env.start()

    def tearDown(self):
        self.client.close()
        self.env.stop()

    @patch.object(C, "get_calendar", return_value=calendar())
    def test_calendar_accepts_93_days_and_rejects_invalid_ranges(self, fetch):
        self.assertEqual(self.client.get("/api/calendar?start=2026-10-01&end=2027-01-01").status_code, 200)
        fetch.assert_called_once_with(date(2026, 10, 1), date(2027, 1, 1))
        for query in ["start=2026-10-02&end=2026-10-01", "start=2026-10-01&end=2027-01-02", "start=bad"]:
            self.assertEqual(self.client.get(f"/api/calendar?{query}").status_code, 422)

    @patch.object(C, "check_notifications", return_value={"checked": True})
    def test_scheduler_auth_post_method_and_safe_default(self, check):
        self.assertEqual(self.client.post("/api/calendar/notification-check").status_code, 401)
        self.assertEqual(self.client.get("/api/calendar/notification-check").status_code, 405)
        self.assertEqual(self.client.post("/api/calendar/notification-check", headers={"Authorization": "Bearer wrong"}).status_code, 401)
        check.assert_not_called()
        headers = {"Authorization": "Bearer scheduler-secret"}
        response = self.client.post("/api/calendar/notification-check", headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        check.assert_called_once_with(dry_run=True)
        self.client.post("/api/calendar/notification-check?dry_run=false", headers=headers)
        check.assert_called_with(dry_run=False)

    @patch.object(C, "build_digest", return_value={"text": "preview"})
    def test_briefing_preview_requires_auth_and_valid_slot(self, digest):
        self.assertEqual(self.client.get("/api/calendar/briefing-preview").status_code, 401)
        headers = {"Authorization": "Bearer scheduler-secret"}
        self.assertEqual(self.client.get("/api/calendar/briefing-preview?slot=invalid", headers=headers).status_code, 422)
        self.assertEqual(self.client.get("/api/calendar/briefing-preview?slot=noon", headers=headers).status_code, 200)
        digest.assert_called_once_with("noon")


if __name__ == "__main__":
    unittest.main()
