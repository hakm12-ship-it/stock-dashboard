"""Returning visitors keep hashed bundles, but always see a deploy's new HTML and service worker."""

from pathlib import Path
import tempfile
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
IMMUTABLE = "public, max-age=31536000, immutable"


class StaticCacheTests(unittest.TestCase):
    def setUp(self):
        import main  # 다른 테스트처럼 수집 시점이 아니라 실행할 때 앱 설정을 읽는다.

        # A fake build so the tests do not depend on `npm run build`.
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        dist = Path(temp.name)
        (dist / "assets").mkdir()
        files = {
            "index.html": '<!doctype html><title>스톡 인사이트 · 한국·미국 주식 리서치</title><script src="/assets/index-BGfpU6LB.js"></script>',
            "assets/index-BGfpU6LB.js": "console.log('app')",
            "assets/index-D9QkTvT1.css": "body{}",
            "sw.js": "self.addEventListener('fetch', () => {})",
            "manifest.webmanifest": '{"name": "스톡 인사이트"}',
            "icon-192.png": "png",
            "favicon.svg": "<svg/>",
            "robots.txt": "User-agent: *\nAllow: /\n",
            "sitemap.xml": '<?xml version="1.0"?><urlset/>',
        }
        for name, body in files.items():
            (dist / name).write_text(body, encoding="utf-8")

        app = FastAPI()

        @app.get("/api/ping")
        def ping():
            return {"ok": True}

        main.mount_frontend(app, dist)
        self.client = TestClient(app)

    def test_hashed_assets_are_cached_for_a_year(self):
        for path in ("/assets/index-BGfpU6LB.js", "/assets/index-D9QkTvT1.css"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["Cache-Control"], IMMUTABLE)

    def test_html_service_worker_manifest_icons_and_search_files_revalidate(self):
        for path in ("/", "/calendar", "/sw.js", "/manifest.webmanifest", "/icon-192.png",
                     "/favicon.svg", "/robots.txt", "/sitemap.xml"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["Cache-Control"], "no-cache")

    def test_revalidation_keeps_the_same_policy(self):
        for path, policy in (("/assets/index-BGfpU6LB.js", IMMUTABLE), ("/sw.js", "no-cache")):
            with self.subTest(path=path):
                etag = self.client.get(path).headers["ETag"]
                response = self.client.get(path, headers={"If-None-Match": etag})
                self.assertEqual(response.status_code, 304)
                self.assertEqual(response.headers["Cache-Control"], policy)

    def test_missing_old_bundle_is_not_pinned(self):
        # After a deploy the previous hash is gone; its 404 must not be cached for a year.
        response = self.client.get("/assets/index-OLDHASH0.js")
        self.assertEqual(response.status_code, 404)
        self.assertNotIn("Cache-Control", response.headers)

    def test_existing_page_behaviour_is_kept(self):
        self.assertEqual(self.client.get("/index.html", follow_redirects=False).status_code, 308)
        self.assertEqual(self.client.get("/calendar/", follow_redirects=False).status_code, 308)
        self.assertTrue(self.client.get("/robots.txt").headers["Content-Type"].startswith("text/plain"))
        self.assertEqual(self.client.get("/sitemap.xml").headers["Content-Type"], "application/xml")
        self.assertIn("경제 캘린더", self.client.get("/calendar").text)

    def test_api_responses_are_untouched(self):
        response = self.client.get("/api/ping")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("Cache-Control", response.headers)
        import main

        health = TestClient(main.app).get("/api/health")
        self.assertEqual(health.headers["X-Robots-Tag"], "noindex, nofollow")
        self.assertNotIn("Cache-Control", health.headers)

    def test_unhashed_public_files_never_land_in_assets(self):
        # Vite copies public/ as-is; a public/assets/ file would be pinned for a year unhashed.
        self.assertFalse((FRONTEND / "public" / "assets").exists())


if __name__ == "__main__":
    unittest.main()
