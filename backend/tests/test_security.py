import os
import unittest
from unittest.mock import patch
from fastapi import HTTPException
from starlette.requests import Request
from security import require_alert_key, require_admin_key


def request(value=""):
    return Request({"type": "http", "headers": [(b"authorization", value.encode())]})


class SecurityTests(unittest.TestCase):
    @patch.dict(os.environ, {"ALERT_CHECK_KEY": "", "ADMIN_KEY": ""})
    def test_unconfigured_fails_closed(self):
        with self.assertRaises(HTTPException) as result:
            require_alert_key(request())
        self.assertEqual(result.exception.status_code, 503)

    @patch.dict(os.environ, {"ALERT_CHECK_KEY": "scheduler-secret", "ADMIN_KEY": "admin-secret"})
    def test_scheduler_requires_correct_bearer(self):
        for value in ("", "Bearer wrong", "scheduler-secret", "Bearer admin-secret"):
            with self.assertRaises(HTTPException):
                require_alert_key(request(value))
        require_alert_key(request("Bearer scheduler-secret"))

    @patch.dict(os.environ, {"ALERT_CHECK_KEY": "", "ADMIN_KEY": "admin-secret"})
    def test_existing_admin_key_fallback(self):
        require_alert_key(request("Bearer admin-secret"))

    @patch.dict(os.environ, {"ALERT_CHECK_KEY": "scheduler-secret", "ADMIN_KEY": "admin-secret"})
    def test_scheduler_cannot_read_admin_diagnostics(self):
        with self.assertRaises(HTTPException):
            require_admin_key(request("Bearer scheduler-secret"))
        require_admin_key(request("Bearer admin-secret"))

    def test_oauth_error_is_not_rendered_as_html(self):
        from routers.alerts import api_kakao_callback
        result = api_kakao_callback(request(), error='<script>alert("x")</script>').body.decode('utf-8')
        self.assertNotIn('<script>', result)
        self.assertIn('&lt;script&gt;', result)
