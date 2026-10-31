"""Gemini request construction; urlopen is mocked so no network is used."""

import io
import json
import os
import unittest
from unittest.mock import patch

import data.ai_briefing as B


class GeminiRequestTests(unittest.TestCase):
    def ask(self, as_json=False):
        reply = {"candidates": [{"content": {"parts": [{"text": "응답"}]}}]}
        with patch.dict(os.environ, {"GEMINI_API_KEY": "mock-secret-key"}), \
             patch.object(B.urllib.request, "urlopen", return_value=io.BytesIO(json.dumps(reply).encode())) as opened:
            text = B._ask("질문", as_json=as_json)
        self.assertEqual(opened.call_count, 1)
        return text, opened.call_args.args[0]

    def test_key_is_sent_in_header_not_url(self):
        text, req = self.ask()
        self.assertEqual(text, "응답")
        self.assertEqual(req.full_url, B._URL)
        self.assertNotIn("mock-secret-key", req.full_url)
        self.assertNotIn("key=", req.full_url)
        self.assertEqual(req.get_header("X-goog-api-key"), "mock-secret-key")
        self.assertEqual(req.get_header("Content-type"), "application/json")
        self.assertEqual(req.get_method(), "POST")

    def test_json_mode_payload_is_unchanged(self):
        _, req = self.ask(as_json=True)
        self.assertEqual(json.loads(req.data), {
            "contents": [{"parts": [{"text": "질문"}]}],
            "generationConfig": {"responseMimeType": "application/json"},
        })

    def test_missing_key_raises_before_network(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": ""}), \
             patch.object(B.urllib.request, "urlopen", side_effect=AssertionError("unexpected network")):
            with self.assertRaises(RuntimeError):
                B._ask("질문")


if __name__ == "__main__":
    unittest.main()
