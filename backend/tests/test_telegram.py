"""텔레그램 공지 — 관리자 1:1 명령만 받고, 결과를 되돌려 주고, 재전송에 중복되지 않는다.

발송은 전부 가로채므로 실제로 메시지가 나가지 않는다.
"""

import os
import unittest

import routers.telegram as T


def _update(user_id: int, chat_type: str, text: str, update_id: int = 1) -> dict:
    return {
        "update_id": update_id,
        "message": {
            "from": {"id": user_id},
            "chat": {"type": chat_type, "id": user_id},
            "text": text,
        },
    }


class _Env(unittest.TestCase):
    ENV: dict = {}

    def setUp(self):
        self._saved = {k: os.environ.get(k) for k in self.ENV}
        for k, v in self.ENV.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        T._seen.clear()
        self.sent: list[tuple[str, str]] = []
        self._send = T.send_telegram_to
        T.send_telegram_to = lambda chat, text: (self.sent.append((chat, text)), True)[1]

    def tearDown(self):
        T.send_telegram_to = self._send
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


class 명령해석(_Env):
    ENV = {"TELEGRAM_ADMIN_USER_ID": "12345"}

    def test_관리자_1대1_announce는_받는다(self):
        self.assertEqual(
            T.announcement_from_update(_update(12345, "private", "/announce 장 마감 공지입니다.")),
            "장 마감 공지입니다.",
        )

    def test_한글_명령도_받는다(self):
        self.assertEqual(
            T.announcement_from_update(_update(12345, "private", "/공지 오늘은 휴장입니다.")),
            "오늘은 휴장입니다.",
        )

    def test_관리자가_아니거나_그룹이면_무시한다(self):
        self.assertIsNone(T.announcement_from_update(_update(999, "private", "/announce 안 됨")))
        self.assertIsNone(T.announcement_from_update(_update(12345, "group", "/announce 안 됨")))

    def test_본문이_없으면_무시한다(self):
        self.assertIsNone(T.announcement_from_update(_update(12345, "private", "/announce")))


class 웹훅처리(_Env):
    ENV = {"TELEGRAM_ADMIN_USER_ID": "12345", "TELEGRAM_ANNOUNCE_CHAT_ID": "-100777"}

    def test_공지는_그룹에_가고_관리자에게_결과를_알린다(self):
        r = T.handle_update(_update(12345, "private", "/announce 오늘 휴장"))
        self.assertTrue(r["announcement"])
        self.assertEqual([c for c, _ in self.sent], ["-100777", "12345"])
        self.assertIn("오늘 휴장", self.sent[0][1])
        self.assertTrue(self.sent[0][1].startswith("📢"))
        self.assertIn("올렸어요", self.sent[1][1])

    def test_같은_update_id가_다시_오면_한_번만_처리한다(self):
        """Telegram은 응답이 늦으면 같은 업데이트를 재전송한다. 공지가 두 번 올라가면 안 된다."""
        T.handle_update(_update(12345, "private", "/announce 중요", update_id=42))
        r = T.handle_update(_update(12345, "private", "/announce 중요", update_id=42))
        self.assertTrue(r.get("duplicate"))
        self.assertEqual(len([c for c, _ in self.sent if c == "-100777"]), 1)

    def test_다른_update_id는_각각_처리한다(self):
        T.handle_update(_update(12345, "private", "/announce 하나", update_id=1))
        T.handle_update(_update(12345, "private", "/announce 둘", update_id=2))
        self.assertEqual(len([c for c, _ in self.sent if c == "-100777"]), 2)

    def test_전송이_실패하면_관리자에게_실패를_알린다(self):
        T.send_telegram_to = lambda chat, text: (self.sent.append((chat, text)), False)[1]
        r = T.handle_update(_update(12345, "private", "/announce 실패해봐"))
        self.assertFalse(r["announcement"])
        self.assertIn("실패", self.sent[-1][1])
        self.assertEqual(self.sent[-1][0], "12345")

    def test_관리자가_아니면_아무것도_보내지_않는다(self):
        r = T.handle_update(_update(999, "private", "/announce 남이 보냄"))
        self.assertFalse(r["announcement"])
        self.assertEqual(self.sent, [])

    def test_명령이_아닌_일반_메시지는_조용히_무시한다(self):
        r = T.handle_update(_update(12345, "private", "안녕"))
        self.assertFalse(r["announcement"])
        self.assertEqual(self.sent, [])


class 대상그룹_미설정(_Env):
    ENV = {"TELEGRAM_ADMIN_USER_ID": "12345", "TELEGRAM_ANNOUNCE_CHAT_ID": None}

    def test_그룹_대신_관리자에게_설정_누락을_알린다(self):
        r = T.handle_update(_update(12345, "private", "/announce 어디로?"))
        self.assertFalse(r["announcement"])
        self.assertFalse(r["configured"])
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.sent[0][0], "12345")
        self.assertIn("TELEGRAM_ANNOUNCE_CHAT_ID", self.sent[0][1])


class 비밀헤더(_Env):
    ENV = {"TELEGRAM_WEBHOOK_SECRET": "s3cret-s3cret-s3cret-s3cret-s3cret"}

    def test_맞는_헤더만_통과한다(self):
        self.assertTrue(T._secret_ok("s3cret-s3cret-s3cret-s3cret-s3cret"))
        self.assertFalse(T._secret_ok("wrong"))
        self.assertFalse(T._secret_ok(None))
        self.assertFalse(T._secret_ok(""))

    def test_서버에_비밀이_없으면_아무것도_통과하지_않는다(self):
        os.environ.pop("TELEGRAM_WEBHOOK_SECRET", None)
        self.assertFalse(T._secret_ok("s3cret-s3cret-s3cret-s3cret-s3cret"))
        self.assertFalse(T._secret_ok(None))


if __name__ == "__main__":
    unittest.main()
