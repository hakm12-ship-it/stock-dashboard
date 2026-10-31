"""Offline calendar fixtures cover DST, uncertainty, revisions and failures."""

from datetime import date, datetime
from concurrent.futures import ThreadPoolExecutor
import threading
import unittest
from unittest.mock import patch

from urllib3.exceptions import ReadTimeoutError

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
NYFED = '''<p>key economic data releases (all Eastern Time).</p><h2>October 2026</h2>
<table><tr><td><div>02<br><a href="https://www.bls.gov">Employment Situation</a><br>(08:30)</div></td>
<td><div>14<br><a href="https://www.bls.gov">Consumer Price Index</a><br>(08:30)</div></td>
<td><div>15<br><a href="https://www.example.com">Other release</a><br>(10:00)<br>
<a href="https://www.bls.gov">Producer Price Index (PPI)</a><br>(08:30)</div></td></tr></table>
<p>Dates and times are tentative and subject to immediate change.</p>'''


def settled(test):
    """Behave like a long-running process, whatever the fake clock reads."""
    patcher = patch.object(C, "_STARTED", float("-inf"))
    patcher.start()
    test.addCleanup(patcher.stop)


def backoff(status):
    return (datetime.fromisoformat(status["nextRefreshAt"]) - datetime.fromisoformat(status["checkedAt"])).total_seconds()


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

    def test_distinct_ics_reference_periods_on_one_day_have_distinct_ids(self):
        payload = ics(
            "UID:q4\nSUMMARY:GDP (Third Estimate), 4th Quarter 2025\nDTSTART:20260430T123000Z",
            "UID:q1\nSUMMARY:GDP (Advance Estimate), 1st Quarter 2026\nDTSTART:20260430T123000Z",
        )
        events = C._parse_ics(payload, "BEA", C.BEA_URL)
        self.assertEqual(len({event["id"] for event in events}), 2)
        # Reordering a publisher's VEVENT list does not change event identity.
        reordered = C._parse_ics(ics(*reversed([
            "UID:q4\nSUMMARY:GDP (Third Estimate), 4th Quarter 2025\nDTSTART:20260430T123000Z",
            "UID:q1\nSUMMARY:GDP (Advance Estimate), 1st Quarter 2026\nDTSTART:20260430T123000Z",
        ])), "BEA", C.BEA_URL)
        self.assertEqual({e["id"] for e in events}, {e["id"] for e in reordered})

    def test_recurring_major_events_fail_explicitly_instead_of_silently_omitting_occurrences(self):
        with self.assertRaisesRegex(ValueError, "반복 일정"):
            C._parse_ics(ics("UID:cpi\nSUMMARY:Consumer Price Index\nDTSTART:20261014T123000Z\nRRULE:FREQ=MONTHLY"), "BLS", C.BLS_URL)

    def test_nyfed_clock_is_eastern_and_explicitly_tentative(self):
        events = C._parse_nyfed(NYFED, 2026, 10, C._nyfed_url(2026, 10))
        self.assertEqual(len(events), 3)
        self.assertEqual(events[1]["startAt"], "2026-10-14T12:30:00+00:00")
        self.assertEqual(events[2]["startAt"], "2026-10-15T12:30:00+00:00")
        self.assertTrue(all(e["timeStatus"] == "tentative" for e in events))
        november = NYFED.replace("October 2026", "November 2026")
        self.assertEqual(C._parse_nyfed(november, 2026, 11, "url")[1]["startAt"], "2026-11-14T13:30:00+00:00")
        with self.assertRaises(ValueError):
            C._parse_nyfed(NYFED, 2027, 10, "url")

    def test_nyfed_missing_clock_does_not_borrow_a_following_release_time(self):
        payload = NYFED.replace('Consumer Price Index</a><br>(08:30)', 'Consumer Price Index</a><br><a href="/other">Other event</a><br>(10:00)')
        event = C._parse_nyfed(payload, 2026, 10, "url")[1]
        self.assertIsNone(event["startAt"])
        self.assertEqual(event["date"], "2026-10-14")


class AggregationTests(unittest.TestCase):
    def setUp(self):
        C._CACHE.clear()
        settled(self)

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

    def test_nyfed_recovers_blocked_bls_without_contacting_fred(self):
        def partial(url):
            if url == C.BLS_URL:
                raise C.requests.Timeout("blocked")
            if "newyorkfed.org" in url:
                return NYFED
            if "stlouisfed.org" in url:
                self.fail("FRED must not be called when NY Fed succeeds")
            return self.fixture(url)
        with patch.object(C, "_download", side_effect=partial) as download:
            response = C.get_calendar(date(2026, 10, 1), date(2026, 10, 31))
            second = C.get_calendar(date(2026, 10, 14), date(2026, 10, 16))
        self.assertEqual(download.call_count, 12)
        self.assertTrue(any(e["source"] == "Federal Reserve Bank of New York" for e in second["events"]))
        self.assertEqual(next(s for s in response["sources"] if s["name"] == "BLS")["status"], "error")
        self.assertTrue(all("checkedAt" in s and "nextRefreshAt" in s for s in response["sources"]))
        self.assertTrue(all("dataAsOf" in s for s in response["sources"] if s["status"] == "ok"))

    def test_last_resort_fred_only_fills_months_nyfed_could_not_load(self):
        def partial(url):
            if url == C.BLS_URL or "i-nov26" in url:
                raise C.requests.Timeout("unavailable")
            if "newyorkfed.org" in url:
                return NYFED
            return self.fixture(url)
        with patch.object(C, "_download", side_effect=partial):
            response = C.get_calendar(date(2026, 10, 1), date(2026, 11, 30))
        fred = [e for e in response["events"] if e["source"] == "FRED · St. Louis Fed"]
        self.assertTrue(fred)
        self.assertTrue(all(e["date"].startswith("2026-11") for e in fred))

    def test_successful_refresh_updates_date_after_ttl_and_cached_failures_keep_original_check_time(self):
        with patch.object(C.time, "monotonic", return_value=100) as clock:
            with patch.object(C, "_download", side_effect=[YAHOO, YAHOO.replace("Oct 29, 2026", "Oct 30, 2026")]) as fetch:
                parser = lambda h: C._parse_earnings(h, "AAPL", "url")
                first = C._load("Yahoo", "url", parser)
                clock.return_value += C._SUCCESS_TTL + 1
                updated = C._load("Yahoo", "url", parser)
            self.assertEqual(first[0][0]["date"], "2026-10-29")
            self.assertEqual(updated[0][0]["date"], "2026-10-30")
            self.assertEqual(fetch.call_count, 2)
        C._CACHE.clear()
        with patch.object(C, "_download", side_effect=C.requests.Timeout("offline")):
            first = C.get_calendar(date(2026, 10, 1), date(2026, 10, 31))
            again = C.get_calendar(date(2026, 10, 1), date(2026, 10, 31))
        self.assertEqual(first["fetchedAt"], again["fetchedAt"])

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

    def test_cold_load_fetches_every_first_wave_source_at_once(self):
        # Eleven sources for one month: they must all be in flight together,
        # otherwise a cold load waits for one timeout after another.
        barrier = threading.Barrier(11, timeout=3)

        def concurrent(url):
            barrier.wait()
            return self.fixture(url)
        with patch.object(C, "_download", side_effect=concurrent):
            response = C.get_calendar(date(2026, 10, 1), date(2026, 10, 31))
        self.assertEqual(len(response["sources"]), 11)
        self.assertTrue(all(s["status"] == "ok" for s in response["sources"]))

    def test_unconfigured_bls_is_never_requested_and_nyfed_starts_before_slow_sources(self):
        nyfed_started = threading.Event()

        def get(url, **kwargs):
            if url == C.BLS_URL:
                raise AssertionError("BLS must not be contacted without a contact address")
            if "newyorkfed.org" in url:
                nyfed_started.set()
                return FakeResponse(NYFED)
            if url == C.BEA_URL and not nyfed_started.wait(timeout=3):
                raise C.requests.Timeout("fallback waited for the slowest source")
            return FakeResponse(self.fixture(url))
        with patch.dict(C.os.environ, {C.CONTACT_ENV: ""}), patch.object(C.requests, "get", side_effect=get) as fetch:
            response = C.get_calendar(date(2026, 10, 1), date(2026, 10, 31))
        sources = {s["name"]: s for s in response["sources"]}
        self.assertEqual(sources["BLS"]["status"], "error")
        self.assertIn(C.CONTACT_ENV, sources["BLS"]["message"])
        self.assertNotIn("403", sources["BLS"]["message"])
        self.assertEqual(sources["BEA"]["status"], "ok")
        self.assertEqual(sources["뉴욕연준 · 2026-10"]["status"], "ok")
        self.assertNotIn(C.BLS_URL, [call.args[0] for call in fetch.call_args_list])
        self.assertTrue(any(e["source"] == "Federal Reserve Bank of New York" for e in response["events"]))


class FakeResponse:
    def __init__(self, body="", status=200, stall=None):
        self.body, self.status_code, self.stall = body.encode(), status, stall

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def raise_for_status(self):
        if self.status_code >= 400:
            response = C.requests.Response()
            response.status_code = self.status_code
            raise C.requests.HTTPError(str(self.status_code), response=response)

    def iter_content(self, size):
        yield self.body
        if self.stall:
            # Headers and the first bytes arrived, then the body stopped.
            raise self.stall


class NetworkPolicyTests(unittest.TestCase):
    def setUp(self):
        C._CACHE.clear()
        settled(self)

    def test_contact_email_is_sent_only_to_bls(self):
        with patch.dict(C.os.environ, {C.CONTACT_ENV: " ops@example.org "}), \
                patch.object(C.requests, "get", return_value=FakeResponse(ics("SUMMARY:Consumer Price Index\nDTSTART:20261014T123000Z"))) as fetch:
            self.assertIn("BEGIN:VCALENDAR", C._download(C.BLS_URL))
            self.assertIn("ops@example.org", fetch.call_args.kwargs["headers"]["User-Agent"])
            # Unofficial Yahoo pages and the other providers keep the previous agent.
            for url in (C.FED_URL, C.BEA_URL, f"{C.BOK_URL}&pYear=2026", "https://finance.yahoo.com/quote/AAPL/calendar/",
                        C._nyfed_url(2026, 10), "https://fred.stlouisfed.org/releases/calendar?rid=10&y=2026"):
                with self.subTest(url=url):
                    C._download(url)
                    self.assertEqual(fetch.call_args.kwargs["headers"]["User-Agent"], "Mozilla/5.0 (compatible; StockInsightCalendar/1.0)")

    def test_missing_or_malformed_contact_blocks_only_bls(self):
        for value in ("", "site admin", "ops@example.org\r\nX-Injected: 1"):
            with self.subTest(value=value), patch.dict(C.os.environ, {C.CONTACT_ENV: value}), \
                    patch.object(C.requests, "get", return_value=FakeResponse(FED)) as fetch:
                status = C._load("BLS", C.BLS_URL, lambda payload: [])[1]
                self.assertEqual(status["status"], "error")
                self.assertIn(C.CONTACT_ENV, status["message"])
                self.assertIn("nextRefreshAt", status)
                fetch.assert_not_called()
                self.assertEqual(C._download(C.FED_URL), FED)
                self.assertNotIn("\n", fetch.call_args.kwargs["headers"]["User-Agent"])
            C._CACHE.clear()

    def test_bea_retries_one_transport_failure_within_its_budget(self):
        payload = ics("SUMMARY:Personal Income and Outlays\nDTSTART:20261029T123000Z")
        with patch.object(C.requests, "get", side_effect=[C.requests.ConnectionError("reset"), FakeResponse(payload)]) as fetch:
            self.assertEqual(C._download(C.BEA_URL), payload)
        self.assertEqual(fetch.call_count, 2)
        (connect, read), budget, _ = C._LIMITS[C.BEA_URL]
        for call in fetch.call_args_list:
            self.assertLessEqual(sum(call.kwargs["timeout"]), budget)
            self.assertGreater(call.kwargs["timeout"][1], C._DEFAULT_LIMITS[0][1])

    def test_retry_never_extends_past_the_budget_or_repeats_http_errors(self):
        clock = [100.0]

        def slow_timeout(url, **kwargs):
            clock[0] += 7
            raise C.requests.Timeout("slow first byte")
        with patch.object(C.time, "monotonic", side_effect=lambda: clock[0]), \
                patch.object(C.requests, "get", side_effect=slow_timeout) as fetch:
            with self.assertRaises(C.requests.Timeout):
                C._download(C.BEA_URL)
        self.assertEqual(fetch.call_count, 1)
        for url in (C.BEA_URL, C.FED_URL):
            with self.subTest(url=url), patch.object(C.requests, "get", return_value=FakeResponse(status=503)) as fetch:
                with self.assertRaises(C.requests.HTTPError):
                    C._download(url)
                self.assertEqual(fetch.call_count, 1)
        with patch.object(C.requests, "get", side_effect=C.requests.ConnectionError("reset")) as fetch:
            with self.assertRaises(C.requests.ConnectionError):
                C._download(C.FED_URL)
        self.assertEqual(fetch.call_count, 1)

    def test_timeouts_are_reported_separately_from_connection_failures(self):
        messages = {}
        for name, error in (("timeout", C.requests.ReadTimeout("slow")), ("connect", C.requests.ConnectionError("refused"))):
            C._CACHE.clear()
            with patch.object(C, "_download", side_effect=error):
                messages[name] = C._load("BEA", C.BEA_URL, lambda payload: [])[1]["message"]
        self.assertIn("제한 시간", messages["timeout"])
        self.assertIn("연결하지 못했습니다", messages["connect"])

    def test_body_that_stalls_after_headers_is_reported_as_a_timeout(self):
        # requests raises this ConnectionError from iter_content when the read
        # timeout expires mid-body; BEA retries it once within its budget.
        for url, attempts in ((C.FED_URL, 1), (C.BEA_URL, 2)):
            C._CACHE.clear()
            stall = C.requests.ConnectionError(ReadTimeoutError(None, url, "Read timed out."))
            with self.subTest(url=url), patch.object(C.requests, "get", return_value=FakeResponse("BEGIN", stall=stall)) as fetch:
                status = C._load("source", url, lambda payload: [])[1]
                self.assertEqual(fetch.call_count, attempts)
                self.assertEqual(status["status"], "error")
                self.assertIn("제한 시간", status["message"])
        C._CACHE.clear()
        reset = C.requests.ConnectionError("connection reset")
        with patch.object(C.requests, "get", return_value=FakeResponse("BEGIN", stall=reset)):
            self.assertIn("연결하지 못했습니다", C._load("source", C.FED_URL, lambda payload: [])[1]["message"])


class StartupRetryTests(unittest.TestCase):
    """A restarted container's first connections can fail before its network settles."""
    fixture = AggregationTests.fixture

    def setUp(self):
        C._CACHE.clear()
        self.addCleanup(C._CACHE.clear)
        started = patch.object(C, "_STARTED", 1000.0)
        started.start()
        self.addCleanup(started.stop)

    def fails_until(self, error, url, at, ttl):
        """Fail once at ``at``; the cached failure must expire exactly ``ttl`` later."""
        C._CACHE.clear()
        with patch.object(C.time, "monotonic", return_value=at) as clock, \
                patch.object(C, "_download", side_effect=error) as fetch:
            status = C._load("source", url, lambda payload: [])[1]
            clock.return_value = at + ttl - 1
            C._load("source", url, lambda payload: [])
            self.assertEqual(fetch.call_count, 1)
            clock.return_value = at + ttl + 1
            C._load("source", url, lambda payload: [])
            self.assertEqual(fetch.call_count, 2)
        self.assertEqual(status["status"], "error")
        self.assertEqual(backoff(status), ttl)
        return status

    def test_transport_failures_right_after_start_retry_within_a_minute(self):
        self.assertLessEqual(C._WARMUP_RETRY_TTL, 60)
        stalled = C.requests.ConnectionError(ReadTimeoutError(None, C.BLS_URL, "Read timed out."))
        for error, message in ((C.requests.ConnectionError("refused"), "연결하지 못했습니다"),
                               (C.requests.ConnectTimeout("dns"), "제한 시간"),
                               (C.requests.ReadTimeout("slow"), "제한 시간"),
                               (stalled, "제한 시간")):
            with self.subTest(error=repr(error)):
                # The last request that still counts as warm-up started 1 s before it ends.
                for at in (1000, 1000 + C._WARMUP - 1):
                    status = self.fails_until(error, C.BLS_URL, at, C._WARMUP_RETRY_TTL)
                    self.assertIn(message, status["message"])

    def test_provider_answers_and_steady_state_failures_keep_their_backoff(self):
        def http(code):
            response = C.requests.Response()
            response.status_code = code
            return C.requests.HTTPError(str(code), response=response)
        fred = "https://fred.stlouisfed.org/releases/calendar?rid=10&y=2026"
        for error, url, at, ttl in (
                (http(403), C.BLS_URL, 1005, C._BLOCKED_TTL),
                (http(429), "https://finance.yahoo.com/quote/AAPL/calendar/", 1005, C._BLOCKED_TTL),
                (http(503), C.BEA_URL, 1005, C._FAILURE_TTL),
                (ValueError("일정 형식이 변경되었습니다."), C.FED_URL, 1005, C._FAILURE_TTL),
                # A source that keeps timing out after warm-up is not retried more often.
                (C.requests.Timeout("slow"), fred, 1000 + C._WARMUP, C._FAILURE_TTL),
                (C.requests.ConnectionError("refused"), fred, 1000 + C._WARMUP + 6 * 60 * 60, C._FAILURE_TTL)):
            with self.subTest(error=repr(error), at=at):
                self.fails_until(error, url, at, ttl)

    def test_missing_bls_contact_is_not_retried_during_warm_up(self):
        with patch.dict(C.os.environ, {C.CONTACT_ENV: ""}), patch.object(C.time, "monotonic", return_value=1005), \
                patch.object(C.requests, "get") as fetch:
            status = C._load("BLS", C.BLS_URL, lambda payload: [])[1]
        fetch.assert_not_called()
        self.assertIn(C.CONTACT_ENV, status["message"])
        self.assertEqual(backoff(status), C._FAILURE_TTL)

    def test_cold_start_outage_clears_on_the_next_request_after_the_retry_delay(self):
        # 2026-10-31: seconds after a restart BLS, 한국은행 and every Yahoo page
        # refused to connect, then answered normally from the same container.
        ready = threading.Event()

        def download(url):
            if not ready.is_set() and any(host in url for host in (C.BLS_URL, "bok.or.kr", "finance.yahoo.com")):
                raise C.requests.ConnectionError("Temporary failure in name resolution")
            if "stlouisfed.org" in url:
                self.fail("FRED must not be called when NY Fed succeeds")
            return NYFED if "newyorkfed.org" in url else self.fixture(url)
        month = (date(2026, 10, 1), date(2026, 10, 31))
        with patch.object(C.time, "monotonic", return_value=1006) as clock, \
                patch.object(C, "_download", side_effect=download) as fetch:
            cold = C.get_calendar(*month)
            failed = [s for s in cold["sources"] if s["status"] == "error"]
            self.assertEqual(len(failed), 9)
            self.assertTrue(all("연결하지 못했습니다" in s["message"] for s in failed))
            self.assertTrue(all(backoff(s) == C._WARMUP_RETRY_TTL for s in failed))
            self.assertTrue(all(backoff(s) == C._SUCCESS_TTL for s in cold["sources"] if s["status"] == "ok"))
            ready.set()
            clock.return_value += C._WARMUP_RETRY_TTL - 1
            self.assertEqual(C.get_calendar(*month)["sources"], cold["sources"])
            self.assertEqual(fetch.call_count, 12)
            clock.return_value += 2
            warm = C.get_calendar(*month)
        # Only the nine failed sources are fetched again; BLS now makes NY Fed unnecessary.
        self.assertEqual(fetch.call_count, 21)
        self.assertEqual(len(warm["sources"]), 11)
        self.assertTrue(all(s["status"] == "ok" for s in warm["sources"]))
        self.assertEqual(len(warm["events"]), 10)


if __name__ == "__main__":
    unittest.main()
