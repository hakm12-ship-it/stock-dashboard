"""Internal scheduler tests use fake delivery; nothing contacts Telegram."""

from concurrent.futures import ThreadPoolExecutor
import os
import threading
import unittest
from unittest.mock import patch

from services import scheduler as S


class SchedulerTests(unittest.TestCase):
    def setUp(self):
        S.stop_scheduler(timeout=3)
        self.env = patch.dict(os.environ, {"NOTIFICATION_INTERNAL_SCHEDULER_ENABLED": ""})
        self.env.start()
        self.original_status = S.notifications.notification_status
        self.status = patch.object(S.notifications, "notification_status", return_value={"ready": True}).start()
        self.check = patch.object(S.notifications, "check_notifications", return_value={"checked": True}).start()

    def tearDown(self):
        S.stop_scheduler(timeout=3)
        patch.stopall()
        self.env.stop()

    def test_default_off_never_starts_or_fetches(self):
        self.assertFalse(S.start_scheduler())
        self.assertFalse(S.scheduler_status()["enabled"])
        self.assertFalse(S.scheduler_status()["running"])
        self.status.assert_not_called()
        self.check.assert_not_called()

    def test_opt_in_still_requires_notification_configuration(self):
        os.environ["NOTIFICATION_INTERNAL_SCHEDULER_ENABLED"] = "true"
        inspected = threading.Event()

        def unavailable():
            inspected.set()
            return {"ready": False}

        self.status.side_effect = unavailable
        self.assertTrue(S.start_scheduler())
        self.assertTrue(inspected.wait(timeout=2))
        S.stop_scheduler()
        self.check.assert_not_called()
        self.assertEqual(S.scheduler_status()["lastOutcome"], "configuration_required")
        self.assertFalse(S.scheduler_status()["running"])

    def test_concurrent_start_and_slow_check_never_duplicate_workers(self):
        os.environ["NOTIFICATION_INTERNAL_SCHEDULER_ENABLED"] = "true"
        started, release = threading.Event(), threading.Event()

        def slow_check(**kwargs):
            started.set()
            release.wait(timeout=3)
            return {"checked": True}

        self.check.side_effect = slow_check
        try:
            with ThreadPoolExecutor(max_workers=2) as callers:
                results = list(callers.map(lambda _: S.start_scheduler(), range(2)))
            self.assertEqual(sorted(results), [False, True])
            self.assertTrue(started.wait(timeout=2))
            S.stop_scheduler(timeout=0.01)
            self.assertTrue(S.scheduler_status()["running"])
            self.assertFalse(S.start_scheduler())
            self.check.assert_called_once_with(dry_run=False)
        finally:
            release.set()
            S.stop_scheduler(timeout=3)
        self.assertFalse(S.scheduler_status()["running"])

    def test_shutdown_interrupts_poll_wait(self):
        os.environ["NOTIFICATION_INTERNAL_SCHEDULER_ENABLED"] = "true"
        checked = threading.Event()
        self.check.side_effect = lambda **kwargs: (checked.set(), {"checked": True})[1]
        self.assertTrue(S.start_scheduler())
        self.assertTrue(checked.wait(timeout=2))
        S.stop_scheduler(timeout=1)
        self.assertFalse(S.scheduler_status()["running"])
        self.assertEqual(S.scheduler_status()["lastOutcome"], "checked")
        self.check.assert_called_once_with(dry_run=False)

    def test_provider_failure_waits_before_retry_and_worker_survives(self):
        # A deterministic stop object runs two ticks without real sleeping.
        class TwoTicks:
            def __init__(self):
                self.intervals = []

            def is_set(self):
                return False

            def wait(self, interval):
                self.intervals.append(interval)
                return len(self.intervals) == 2

        os.environ["NOTIFICATION_INTERNAL_SCHEDULER_ENABLED"] = "true"
        self.check.side_effect = [RuntimeError("private URL must not be logged"), {"checked": True}]
        stop = TwoTicks()
        with self.assertLogs(S.logger, level="WARNING") as messages:
            with patch.object(S.time, "time", return_value=600):
                S._run(stop)
        self.assertEqual(stop.intervals, [300, 300])
        self.assertEqual(self.check.call_count, 2)
        self.assertEqual(S.scheduler_status()["lastOutcome"], "checked")
        self.assertNotIn("private URL", "\n".join(messages.output))

    def test_next_tick_stays_on_five_minute_boundaries_after_slow_work(self):
        with patch.object(S.time, "time", side_effect=[193, 600, 631, 901]):
            self.assertEqual(S._seconds_to_next_tick(), 107)
            self.assertEqual(S._seconds_to_next_tick(), 300)
            self.assertEqual(S._seconds_to_next_tick(), 269)
            self.assertEqual(S._seconds_to_next_tick(), 299)

    def test_public_status_uses_live_internal_state_or_explicit_external_flag(self):
        with patch.dict(os.environ, {"NOTIFICATION_SCHEDULER_ACTIVE": ""}):
            with patch.object(S, "scheduler_status", return_value={"running": True}):
                self.assertTrue(self.original_status()["schedulerActive"])
            with patch.object(S, "scheduler_status", return_value={"running": False}):
                self.assertFalse(self.original_status()["schedulerActive"])
                os.environ["NOTIFICATION_SCHEDULER_ACTIVE"] = "true"
                self.assertTrue(self.original_status()["schedulerActive"])


if __name__ == "__main__":
    unittest.main()
