"""Spam prevention: durable claims, concurrent checks, reversals, and cooldowns.

Every provider and external delivery is mocked; no Telegram requests are made.
"""

import importlib.util
import json
import os
import sqlite3
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from services import alert_delivery as D
from tests.test_alerts import _Base, DAY, NIGHT


class AlertDeliveryTests(_Base):
    def test_reversals_and_small_changes_cannot_repeat_in_a_burst(self):
        self.night(-1)
        for minute, gap in enumerate([-3.5, 3.5, -3.6, 3.6, -3.7, 3.7], start=1):
            self.night(gap, now=NIGHT + timedelta(minutes=minute))
        self.assertEqual(len(self.sent), 1)
        # Returning to the same levels after the cooldown is not a new event.
        self.night(3.7, now=NIGHT + timedelta(hours=2))
        self.night(-3.7, now=NIGHT + timedelta(hours=2, minutes=1))
        self.assertEqual(len(self.sent), 1)

    def test_suppressed_worsening_is_discarded_instead_of_queued(self):
        self.night(-1)
        self.night(-3.5)
        suppressed = self.night(-5.1, now=NIGHT + timedelta(minutes=1))
        self.assertEqual(suppressed["deliveryStatus"], "cooldown")
        self.assertEqual(suppressed["suppressed"], 2)
        self.restart()
        self.night(-5.1, now=NIGHT + timedelta(hours=1))
        self.assertEqual(len(self.sent), 1)
        self.night(-7, now=NIGHT + timedelta(hours=1, minutes=1))
        self.assertEqual(len(self.sent), 2)

    def test_all_stocks_are_combined_and_one_hour_boundary_is_exact(self):
        self.night(-1)
        self.night(-3.5)
        self.assertEqual(len(self.sent), 1)
        for _, name in self.api.WATCH:
            self.assertIn(name, self.sent[0])
        self.night(-5.1, now=NIGHT + timedelta(seconds=3599))
        self.assertEqual(len(self.sent), 1)
        self.night(-7, now=NIGHT + timedelta(seconds=3600))
        self.assertEqual(len(self.sent), 2)

    def test_market_night_and_test_calls_share_the_same_budget(self):
        self.day(0)
        self.day(5.5)
        real, fake = self._at(DAY + timedelta(minutes=1))
        self.api.datetime = fake
        self.api.api_night_price = lambda _: {"available": False}
        try:
            result = self.api.api_night_alert_check(test=True)
        finally:
            self.api.datetime = real
        self.assertEqual(result["deliveryStatus"], "cooldown")
        self.assertEqual(len(self.sent), 1)

    def test_midnight_does_not_reset_the_cooldown_or_session(self):
        start = NIGHT.replace(hour=23, minute=58)
        self.night(-1, now=start)
        self.night(-3.5, now=start + timedelta(minutes=1))
        self.night(-5.1, now=start + timedelta(minutes=3))
        self.assertEqual(len(self.sent), 1)

    def test_sidecar_each_direction_remains_consumed_after_reversals_and_restart(self):
        self.day(0)
        self.day(0, fut=-5.2, after=0)
        self.day(0, fut=-5.2, after=60)
        self.day(0, fut=5.2, after=3600)
        self.day(0, fut=5.2, after=3660)
        self.assertEqual(len(self.sent), 2)
        self.restart()
        self.day(0, fut=-5.2, after=7200)
        self.day(0, fut=-5.2, after=7260)
        self.assertEqual(len(self.sent), 2)

    def test_first_success_is_primed_separately_for_each_symbol(self):
        original_watch = self.api.WATCH
        self.api.WATCH = [original_watch[0]]
        self.night(-1)
        self.api.WATCH = original_watch
        self.night(-1, worst=-1)  # First successful quote for the second symbol.
        self.assertEqual(self.sent, [])
        # Even if the first successful observation was already above threshold,
        # it only establishes that symbol's baseline.
        self.restart()
        self.api.WATCH = [original_watch[0]]
        self.day(0)
        self.api.WATCH = original_watch
        self.day(5.5)
        self.assertEqual(len(self.sent), 1)
        self.assertNotIn(original_watch[1][1], self.sent[0])

    def test_unavailable_night_data_does_not_mark_symbols_as_primed(self):
        self.api.api_night_price = lambda _: {"available": False}
        real, fake = self._at(NIGHT)
        self.api.datetime = fake
        try:
            self.api.api_night_alert_check()
        finally:
            self.api.datetime = real
        self.night(-7.2)
        self.assertEqual(self.sent, [])

    def test_unknown_delivery_is_never_retried_after_restart(self):
        self.night(-1)
        self.api.notify = lambda text: (_ for _ in ()).throw(TimeoutError("secret URL"))
        with self.assertLogs(self.api.logger, "WARNING") as logs:
            first = self.night(-3.5)
        self.assertEqual(first["deliveryStatus"], "delivery_unknown")
        self.assertNotIn("secret URL", " ".join(logs.output))
        self.restart()
        self.night(-3.5, now=NIGHT + timedelta(hours=2))
        self.assertEqual(self.sent, [])
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM market_alert_deliveries").fetchone()[0], 1)

    def test_missing_or_corrupt_state_fails_closed(self):
        with patch.dict(os.environ, {"NOTIFICATION_STATE_PATH": ""}):
            result = self.night(-9)
        self.assertEqual(result["deliveryStatus"], "state_unavailable")
        self.path.write_text("corrupt", encoding="utf-8")
        with self.assertLogs(D.logger, "WARNING"):
            result = self.night(-9)
        self.assertEqual(result["deliveryStatus"], "state_unavailable")
        self.assertEqual(self.sent, [])

    def test_invalid_provider_values_never_send_or_poison_state(self):
        self.night(float("nan"))
        self.night(float("inf"))
        self.night(-5)
        self.assertEqual(self.sent, [])

    def test_concurrent_workers_and_separate_sessions_reserve_only_one_batch(self):
        def reserve(i):
            with D.alert_state("market" if i % 2 else "night", str(i), DAY) as guard:
                return guard.reserve_delivery()
        with ThreadPoolExecutor(max_workers=8) as pool:
            attempts = list(pool.map(reserve, range(16)))
        self.assertEqual(sum(attempt is not None for attempt in attempts), 1)
        # A fresh import is independent of all module-local state.
        spec = importlib.util.spec_from_file_location("restarted_delivery", D.__file__)
        module = importlib.util.module_from_spec(spec)
        import sys
        sys.modules[spec.name] = module
        try:
            spec.loader.exec_module(module)
            with module.alert_state("night", "another-session", DAY) as guard:
                self.assertIsNone(guard.reserve_delivery())
        finally:
            sys.modules.pop(spec.name, None)

    def test_simultaneous_endpoint_calls_send_the_same_event_once(self):
        self.night(-1)
        self.api.api_night_price = lambda _: {"available": True, "gapPct": -3.5,
                                            "krxClose": 100, "krw": 96.5}
        real, fake = self._at(NIGHT + timedelta(minutes=1))
        self.api.datetime = fake
        try:
            with ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(lambda _: self.api.api_night_alert_check(), range(8)))
        finally:
            self.api.datetime = real
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(sum(result["sent"] for result in results), 1)

    def test_existing_briefing_ledger_is_preserved(self):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("CREATE TABLE notification_jobs (job_id TEXT PRIMARY KEY, status TEXT)")
            db.execute("INSERT INTO notification_jobs VALUES ('previous-job', 'sent')")
        self.night(-1)
        self.night(-3.5)
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute("SELECT * FROM notification_jobs").fetchall(), [("previous-job", "sent")])


class SchedulerSummaryTests(unittest.TestCase):
    def test_suppression_is_normal_and_state_failure_is_an_error(self):
        path = Path(__file__).resolve().parents[2] / "deploy/home-server-alerts/check_alert.py"
        spec = importlib.util.spec_from_file_location("alert_check", path)
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        inspected = [{"Name": "/stock-insight-abc-123", "Config": {"Env": ["ALERT_CHECK_KEY=secret"]},
                      "HostConfig": {"PortBindings": {"8000/tcp": [{"HostIp": "127.0.0.1", "HostPort": "8010"}]}}}]
        with patch.dict(os.environ, {"STOCK_INSIGHT_CONTAINER_PREFIX": "stock-insight-abc-"}), \
             patch.object(helper.sys, "argv", ["check_alert.py", "night"]), \
             patch.object(helper.subprocess, "check_output", side_effect=lambda args, **kw:
                          "container-id" if args[1] == "ps" else json.dumps(inspected)), \
             patch.object(helper.urllib.request, "urlopen") as opened, \
             patch("builtins.print"):
            response = opened.return_value.__enter__.return_value
            response.status = 200
            for status, expected in [("cooldown", 0), ("state_unavailable", 1), ("delivery_unknown", 1)]:
                response.read.return_value = json.dumps({"checked": True, "alerts": 2,
                                                        "deliveryStatus": status, "sent": False}).encode()
                self.assertEqual(helper.main(), expected)


class TelegramRecipientsTests(unittest.TestCase):
    def test_duplicate_configured_recipients_get_one_copy(self):
        from data import telegram as T
        with patch.dict(os.environ, {"TELEGRAM_CHAT_ID": "123, 123, -456, -456", "TELEGRAM_BOT_TOKEN": "fake"}), \
             patch.object(T, "send_telegram_to", return_value=True) as send:
            self.assertTrue(T.send_telegram("text"))
        self.assertEqual([call.args[0] for call in send.call_args_list], ["123", "-456"])
