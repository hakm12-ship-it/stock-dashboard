"""Public calendar access, search rendering resources, and canonical routes."""

from datetime import date
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.robotparser import RobotFileParser
from xml.etree import ElementTree

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import calendar


FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
PUBLIC = "https://stock-insight-zws6.onrender.com"


class PublicCalendarTests(unittest.TestCase):
    def test_search_can_render_public_calendar_but_not_private_operations(self):
        robots = RobotFileParser()
        robots.parse((FRONTEND / "public" / "robots.txt").read_text(encoding="utf-8").splitlines())
        for path in ("/", "/calendar", "/api/calendar", "/api/calendar?start=2026-10-01&end=2026-10-31"):
            self.assertTrue(robots.can_fetch("Googlebot", PUBLIC + path), path)
        for path in ("/api/calendar/briefing-preview", "/api/calendar/notification-check", "/api/calendar/notification-status", "/api/prices", "/docs", "/redoc", "/openapi.json"):
            self.assertFalse(robots.can_fetch("Googlebot", PUBLIC + path), path)
        self.assertIn(PUBLIC + "/sitemap.xml", robots.site_maps())
        sitemap = ElementTree.parse(FRONTEND / "public" / "sitemap.xml")
        locations = [node.text for node in sitemap.findall(".//{http://www.sitemaps.org/schemas/sitemap/0.9}loc")]
        self.assertEqual(set(locations), {PUBLIC + "/", PUBLIC + "/calendar"})

    def test_public_route_uses_bounded_range_and_never_fetches_invalid_dates(self):
        app = FastAPI()
        app.include_router(calendar.router)
        client = TestClient(app)
        with patch.object(calendar, "get_calendar", return_value={"events": [], "sources": []}) as fetch:
            valid = client.get("/api/calendar?start=2026-10-01&end=2026-10-31")
            self.assertEqual(valid.status_code, 200)
            fetch.assert_called_once_with(date(2026, 10, 1), date(2026, 10, 31))
            fetch.reset_mock()
            for query in ("start=2026-10-02&end=2026-10-01", "start=2026-01-01&end=2026-12-31", "start=9999-12-31"):
                self.assertEqual(client.get("/api/calendar?" + query).status_code, 422)
            fetch.assert_not_called()

    @unittest.skipUnless((FRONTEND / "dist" / "index.html").is_file(), "Build the frontend to verify production HTML routes")
    def test_production_calendar_has_its_own_canonical_and_json_remains_noindex(self):
        import main

        # Do not enter the lifespan or start a scheduler while testing routes.
        client = TestClient(main.app)
        html = client.get("/calendar")
        self.assertEqual(html.status_code, 200)
        self.assertIn('<link rel="canonical" href="' + PUBLIC + '/calendar"', html.text)
        self.assertIn("경제 캘린더 · 금리·경제지표·빅테크 실적", html.text)
        redirect = client.get("/calendar/", follow_redirects=False)
        self.assertEqual(redirect.status_code, 308)
        self.assertEqual(redirect.headers["location"], "/calendar")
        with patch.object(calendar, "get_calendar", return_value={"events": [], "sources": []}):
            response = client.get("/api/calendar?start=2026-10-01&end=2026-10-31")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["X-Robots-Tag"], "noindex, nofollow")
        self.assertEqual(client.get("/api/calendar/briefing-preview").headers["X-Robots-Tag"], "noindex, nofollow")


if __name__ == "__main__":
    unittest.main()
