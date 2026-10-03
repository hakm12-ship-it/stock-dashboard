"""Offline calendar fixtures cover DST, uncertainty, revisions and failures."""

from datetime import date
from concurrent.futures import ThreadPoolExecutor
import threading
import unittest
from unittest.mock import patch

from data import economic_calendar as C


def ics(*events):
    return "BEGIN:VCALENDAR\nVERSION:2.0\n" + "\n".join("BEGIN:VEVENT\n" + event + "\nEND:VEVENT" for event in events) + "\nEND:VCALENDAR"


FED = '''<h4>2026 FOMC Meetings</h4>
<div class="fomc-meeting__month col-xs-5"><strong>March</strong></div>
<div class="fomc-meeting__date col-xs-4">17-18*</div>
<div class="fomc-meeting__month">December</div><div class="fomc-meeting__date">8-9</div>
<h4>2027 FOMC Meetings</h4>
<div class="fomc-meeting__month">January/February</div><div class="fomc-meeting__date">31-1</div>'''
BOK = '''<select><option value="2026" selected="selected">2026년</option></select>
<table id="tableId"><tr><th scope="row">10월 22일(목)</th><td>자료</td></tr></table>'''
YAHOO = '''<li class="yf"><span class="label" title="Earnings Date">Earnings Date</span>
<span class="value yf" title="Oct 29, 2026">Oct 29, 2026</span></li>'''
FRED = '''<div id="release-dates-pager"><table>
<tr><td><span style="font-weight: bold;">Wednesday October 14, 2026</span></td></tr>
<tr><td>7:30 am</td><td><a href="/release?rid=10">Consumer Price Index</a></td></tr>
<tr><td><span style="font-weight: bold;">Tuesday November 10, 2026</span></td></tr>
<tr><td>7:30 am</td><td><a href="/release?rid=10">Consumer Price Index</a></td></tr>
</table></div>All times are US Central Time.'''


class ParsingTests(unittest.TestCase):
    def test_ics_eastern_dst_and_folded_summary(self):
        payload = ics(
            "UID:winter\nSUMMARY:Consumer Price Index\nDTSTART;TZID=America/New_York:20260113T083000",
            "UID:summer\nSUMMARY:Employment Situ\n ation\nDTSTART;TZID=America/New_York:20260702T083000",
        )
        winter, summer = C._parse_ics(payload, "BLS", C.BLS_URL)
        self.assertEqual(winter["startAt"], "2026-01-13T13:30:00+00:00")
        self.assertEqual(summer["startAt"], "2026-07-02T12:30:00+00:00")
        self.assertEqual(winter["timeStatus"], "confirmed")

    def test_utc_rollover_and_date_only_are_distinct(self):
        payload = ics(
            "SUMMARY:Personal Income and Outlays\\, September\nDTSTART:20261029T200000Z",
            "SUMMARY:GDP (Advance Estimate)\nDTSTART;VALUE=DATE:20261029",
        )
        timed, untimed = C._parse_ics(payload, "BEA", C.BEA_URL)
        self.assertEqual(timed["date"], "2026-10-30")
        self.assertEqual(untimed["date"], "2026-10-29")
        self.assertIsNone(untimed["startAt"])
        self.assertEqual(untimed["timeStatus"], "date_only")
        self.assertIn(", September", timed["description"])

    def test_cancelled_revision_does_not_trigger_alert(self):
        payload = ics(
            "UID:cpi\nSEQUENCE:0\nSUMMARY:Consumer Price Index\nDTSTART:20261014T123000Z",
            "UID:cpi\nSEQUENCE:1\nSTATUS:CANCELLED\nSUMMARY:Consumer Price Index\nDTSTART:20261014T123000Z",
            "UID:pce\nSTATUS:TENTATIVE\nSUMMARY:Personal Income and Outlays\nDTSTART:20261029T123000Z",
        )
        events = C._parse_ics(payload, "BEA", C.BEA_URL)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["timeStatus"], "tentative")

    def test_state_and_county_gdp_are_not_national_gdp(self):
        events = C._parse_ics(ics(
            "SUMMARY:GDP by County and Personal Income by County\nDTSTART:20261202T133000Z",
            "SUMMARY:Gross Domestic Product by State and Personal Income by State\nDTSTART:20261202T133000Z",
            "SUMMARY:GDP (Third Estimate), Industries\nDTSTART:20261223T133000Z",
        ), "BEA", C.BEA_URL)
        self.assertEqual(len(events), 1)
        self.assertIn("확정치", events[0]["title"])

    def test_fed_uses_final_meeting_day_and_marks_clock_tentative(self):
        march, december, cross_month = C._parse_fed(FED)
        self.assertEqual(march["startAt"], "2026-03-18T18:00:00+00:00")
        self.assertEqual(march["date"], "2026-03-19")
        self.assertEqual(december["startAt"], "2026-12-09T19:00:00+00:00")
        self.assertEqual(cross_month["date"], "2027-02-02")
        self.assertTrue(all(e["timeStatus"] == "tentative" for e in (march, december, cross_month)))

    def test_bok_does_not_invent_a_release_time_or_wrong_year(self):
        event = C._parse_bok(BOK, 2026, C.BOK_URL)[0]
        self.assertEqual(event["date"], "2026-10-22")
        self.assertEqual(event["timeStatus"], "date_only")
        self.assertIsNone(event["startAt"])
        with self.assertRaises(ValueError):
            C._parse_bok(BOK, 2027, C.BOK_URL)

    def test_earnings_estimate_has_no_fake_midnight(self):
        event = C._parse_earnings(YAHOO, "AAPL", "https://finance.yahoo.com/quote/AAPL/calendar/")[0]
        self.assertEqual(event["date"], "2026-10-29")
        self.assertEqual(event["timeStatus"], "tentative")
        self.assertIsNone(event["startAt"])
        self.assertEqual(event["ticker"], "AAPL")
        estimated = C._parse_earnings(YAHOO.replace("Earnings Date", "Earnings Date (est.)"), "MSFT", "unused")[0]
        self.assertEqual(estimated["timeStatus"], "tentative")
        with self.assertRaises(ValueError):
            C._parse_earnings(YAHOO.replace("Oct 29, 2026", "Oct 29, 2026 - Nov 2, 2026"), "AAPL", "unused")

    def test_fred_central_dst_is_not_eastern_time(self):
        october, november = C._parse_fred(FRED, "cpi", "CPI", "https://fred.stlouisfed.org")
        self.assertEqual(october["startAt"], "2026-10-14T12:30:00+00:00")
        self.assertEqual(november["startAt"], "2026-11-10T13:30:00+00:00")
        with self.assertRaises(ValueError):
            C._parse_fred(FRED.replace("All times are US Central Time", ""), "cpi", "CPI", "unused")


class AggregationTests(unittest.TestCase):
    def setUp(self):
        C._CACHE.clear()

    def fixture(self, url):
        if url == C.FED_URL:
            return FED
        if url == C.BLS_URL:
            return ics("SUMMARY:Consumer Price Index\nDTSTART:20261014T123000Z")
        if url == C.BEA_URL:
            return ics("SUMMARY:Personal Income and Outlays\nDTSTART:20261029T123000Z")
        if "bok.or.kr" in url:
            return BOK
        if "fred.stlouisfed.org" in url:
            return FRED
        return YAHOO

    def test_range_is_inclusive_cached_and_mutation_safe(self):
        with patch.object(C, "_download", side_effect=self.fixture) as fetch:
            response = C.get_calendar(date(2026, 10, 14), date(2026, 10, 29))
            self.assertEqual(len(response["events"]), 10)
            self.assertEqual(len(response["sources"]), 11)
            self.assertEqual(response["timezone"], "Asia/Seoul")
            response["events"][0]["title"] = "mutated"
            again = C.get_calendar(date(2026, 10, 14), date(2026, 10, 29))
            self.assertNotIn("mutated", [event["title"] for event in again["events"]])
            self.assertEqual(fetch.call_count, 11)
            self.assertTrue(all(event["sourceUrl"].startswith("https://") for event in again["events"]))

    def test_failed_bls_retains_other_sources_and_uses_fred(self):
        def partial(url):
            if url == C.BLS_URL:
                raise C.requests.Timeout("no response")
            return self.fixture(url)
        with patch.object(C, "_download", side_effect=partial):
            response = C.get_calendar(date(2026, 10, 1), date(2026, 10, 31))
        bls = next(s for s in response["sources"] if s["name"] == "BLS")
        self.assertEqual(bls["status"], "error")
        self.assertEqual(len([s for s in response["sources"] if s["name"].startswith("FRED")]), 2)
        self.assertTrue(any(event["source"] == "FRED · St. Louis Fed" for event in response["events"]))
        self.assertTrue(any(event.get("ticker") == "MSFT" for event in response["events"]))

    def test_overlapping_requests_for_different_ranges_download_each_source_once(self):
        started, release, second_entered = threading.Event(), threading.Event(), threading.Event()

        def delayed_download(url):
            started.set()
            if not release.wait(timeout=3):
                raise AssertionError("test download was not released")
            return self.fixture(url)

        def second_request():
            second_entered.set()
            return C.get_calendar(date(2026, 10, 20), date(2026, 11, 30))

        with patch.object(C, "_download", side_effect=delayed_download) as fetch:
            with ThreadPoolExecutor(max_workers=2) as clients:
                first = clients.submit(C.get_calendar, date(2026, 10, 1), date(2026, 10, 31))
                try:
                    self.assertTrue(started.wait(timeout=3))
                    second = clients.submit(second_request)
                    self.assertTrue(second_entered.wait(timeout=3))
                finally:
                    release.set()
                october, later = first.result(timeout=5), second.result(timeout=5)
            self.assertEqual(fetch.call_count, 11)
            self.assertEqual(len({call.args[0] for call in fetch.call_args_list}), 11)
            self.assertEqual(len(october["events"]), 10)
            self.assertEqual(len(later["events"]), 9)

    def test_successful_schedules_and_earnings_are_cached_six_hours(self):
        for url in (C.FED_URL, "https://finance.yahoo.com/quote/AAPL/calendar/"):
            with self.subTest(url=url), patch.object(C.time, "monotonic", return_value=100) as clock:
                with patch.object(C, "_download", return_value="fixture") as fetch:
                    parser = lambda payload: []
                    C._load("source", url, parser)
                    clock.return_value = 100 + 6 * 60 * 60 - 1
                    C._load("source", url, parser)
                    self.assertEqual(fetch.call_count, 1)
                    clock.return_value += 2
                    C._load("source", url, parser)
                    self.assertEqual(fetch.call_count, 2)

    def test_failures_back_off_fifteen_minutes_and_blocked_sources_one_hour(self):
        for code, ttl in ((None, 15 * 60), (403, 60 * 60), (429, 60 * 60)):
            with self.subTest(status=code):
                C._CACHE.clear()
                if code is None:
                    error = C.requests.Timeout("offline")
                else:
                    response = C.requests.Response()
                    response.status_code = code
                    error = C.requests.HTTPError("blocked", response=response)
                with patch.object(C.time, "monotonic", return_value=100) as clock:
                    with patch.object(C, "_download", side_effect=error) as fetch:
                        first = C._load("BLS", C.BLS_URL, lambda payload: [])
                        self.assertEqual(first[1]["status"], "error")
                        clock.return_value = 100 + ttl - 1
                        C._load("BLS", C.BLS_URL, lambda payload: [])
                        self.assertEqual(fetch.call_count, 1)
                        clock.return_value += 2
                        C._load("BLS", C.BLS_URL, lambda payload: [])
                        self.assertEqual(fetch.call_count, 2)

    def test_complete_outage_is_visible_and_not_fabricated(self):
        with patch.object(C, "_download", side_effect=C.requests.Timeout("offline")):
            response = C.get_calendar(date(2026, 10, 1), date(2026, 10, 31))
        self.assertEqual(response["events"], [])
        self.assertTrue(all(s["status"] == "error" for s in response["sources"]))

    def test_invalid_ranges_do_not_contact_providers(self):
        with patch.object(C, "_download") as fetch:
            for start, end in ((date(2026, 10, 2), date(2026, 10, 1)), (date(2026, 1, 1), date(2026, 12, 31))):
                with self.assertRaises(ValueError):
                    C.get_calendar(start, end)
            fetch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
