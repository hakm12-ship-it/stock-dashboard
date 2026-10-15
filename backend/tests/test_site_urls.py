"""Moving hosts must update every public search URL while keeping APIs private."""

import os
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.robotparser import RobotFileParser
from xml.etree import ElementTree

from fastapi.testclient import TestClient

from site_urls import DEFAULT_PUBLIC_SITE_URL, public_site_url

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
PUBLIC = "https://stock.example.ts.net:8443"


class SiteURLTests(unittest.TestCase):
    def test_existing_render_address_is_the_default(self):
        with patch.dict(os.environ, {"PUBLIC_SITE_URL": ""}):
            self.assertEqual(public_site_url(), DEFAULT_PUBLIC_SITE_URL)

    def test_accepts_https_tunnel_origin_with_port(self):
        with patch.dict(os.environ, {"PUBLIC_SITE_URL": " " + PUBLIC + "/ "}):
            self.assertEqual(public_site_url(), PUBLIC)

    def test_rejects_paths_credentials_and_metadata_injection(self):
        for value in (
            "javascript:alert(1)", "https://example.com/app", "https://user:pass@example.com",
            "https://example.com?secret=value", "https://example.com#fragment",
            'https://example.com/\"><script>', "https://example.com\nSitemap: bad",
            "https://example.com:invalid",
        ):
            with self.subTest(value=value), patch.dict(os.environ, {"PUBLIC_SITE_URL": value}):
                with self.assertRaises(ValueError):
                    public_site_url()

    @unittest.skipUnless((FRONTEND / "dist" / "index.html").is_file(), "Build the frontend first")
    def test_public_pages_and_search_files_use_the_new_origin(self):
        import main

        # No lifespan: do not start schedulers or send notifications.
        client = TestClient(main.app)
        with patch.dict(os.environ, {"PUBLIC_SITE_URL": PUBLIC}):
            for path in ("/", "/calendar"):
                response = client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertIn(f'<link rel="canonical" href="{PUBLIC}{path}"', response.text)
                self.assertIn(f'property="og:url" content="{PUBLIC}{path}"', response.text)
                self.assertIn(f'property="og:image" content="{PUBLIC}/icon-512.png"', response.text)
                self.assertNotIn(DEFAULT_PUBLIC_SITE_URL, response.text)
            self.assertEqual(client.get("/index.html", follow_redirects=False).status_code, 308)
            robots = RobotFileParser()
            robots.parse(client.get("/robots.txt").text.splitlines())
            self.assertEqual(robots.site_maps(), [PUBLIC + "/sitemap.xml"])
            self.assertTrue(robots.can_fetch("Googlebot", PUBLIC + "/calendar"))
            self.assertFalse(robots.can_fetch("Googlebot", PUBLIC + "/api/kakao-token-status"))
            sitemap = client.get("/sitemap.xml")
            self.assertEqual(sitemap.status_code, 200)
            locations = [node.text for node in ElementTree.fromstring(sitemap.text).iter()
                         if node.tag.endswith("}loc")]
            self.assertEqual(set(locations), {PUBLIC + "/", PUBLIC + "/calendar"})
            health = client.get("/api/health")
            self.assertEqual(health.status_code, 200)
            self.assertEqual(health.headers["X-Robots-Tag"], "noindex, nofollow")


if __name__ == "__main__":
    unittest.main()
