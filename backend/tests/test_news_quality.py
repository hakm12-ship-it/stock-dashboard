"""Junk titles (template placeholders, quote/option pages) never reach news or briefings; no network."""

from contextlib import closing
from datetime import datetime, timedelta, timezone
import io
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from xml.sax.saxutils import escape

import data.market_digest as D
import data.news as N
import data.public_briefing as B
from data.news import is_junk_title

# 2026-10-31 저녁 브리핑에 실제로 나온 항목들(제목은 Google News 형식 그대로).
EVENING = datetime(2026, 10, 31, 19, 0, tzinfo=B.KST)
PLACEHOLDER = "META_TITLE_QUOTE"
OPTION_PAGE = "SOXL Oct 2026 162.500 put (SOXL261030P00162500) Stock Historical Prices & Data"
# /api/news?name=SOXL에 섞여 나온 나머지 시세 페이지들(야후·마켓워치·트레이딩뷰, 출처 꼬리표 제거 후).
QUOTE_PAGES = [
    "Direxion Daily Semiconductor Bull 3X Shares (SOXL) Options Chain",
    "SOXL Holdings",
    "Direxion Daily Semiconductor Bull 3X Shares (SOXL) Company Profile & Facts",
    "Direxion Daily Semiconductor Bull 3X Shares (SOXL) Valuation Measures & Financial Statistics",
    "SOXL Stock Price | Direxion Daily Semiconductor Bull 3X Shares ETF Stock Quote (U.S.: NYSE Arca) | MarketWatch",
    "SOXL Stock Price and Chart — AMEX:SOXL — TradingView",
]
GOOD_TITLES = [
    "삼성전자, 3분기 영업이익 10조 돌파…반도체 실적 회복",
    "코스피 2,600선 회복, 외국인 순매수",
    "S&P 500 hits record as AI rally lifts Nvidia",
    "Fed holds interest rates at 4.25%-4.50%",
    "Meta shares jump after earnings beat",
    "Treasury yields fall as inflation cools",
]


def rss(entries) -> bytes:
    rows = "".join(
        f"<item><title>{escape(title)}</title><source>{source}</source><link>{link}</link><pubDate>{date}</pubDate></item>"
        for title, source, link, date in entries
    )
    return f"<rss><channel>{rows}</channel></rss>".encode()


def gmt(at: datetime) -> str:
    return at.astimezone(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")


class TitleQualityTest(unittest.TestCase):
    def test_placeholders_empty_and_quote_pages_are_junk(self):
        for title in (
            PLACEHOLDER, f"속보: {PLACEHOLDER}", "NEWS_HEADLINE_1", "{{title}}", "${headline}", "Untitled", "null",
            "", "   ", "-", "…", "1", "2026", OPTION_PAGE, "SOXL261030C00150000",
            "SOXL Oct 2026 162.500 call", "Direxion Daily Semiconductor Bull 3X Shares (SOXL) Stock Historical Prices & Data",
            "Spotify Stock Price, News, Quote & History", "SOXL Interactive Stock Chart | Direxion Daily Semiconductor Bull 3X",
            "삼성전자 주가 - 실시간 시세 조회",
        ):
            with self.subTest(title=title):
                self.assertTrue(is_junk_title(title))

    def test_legitimate_headlines_are_kept(self):
        for title in (
            *GOOD_TITLES, "AI", "Q3", "NVDA, AAPL lead Nasdaq higher", "Meta Platforms (META) Q3 earnings preview",
            "SOXL jumps 8% as chip stocks rally", "U.S. GDP grew 2.8% in Q3", "Top 10 ETFs for Oct 2026",
            "Traders buy Nvidia Jan 2027 150 calls", "KOSPI 200 선물 강세", "BOJ, 금리 동결", "환율 1,400원 돌파",
        ):
            with self.subTest(title=title):
                self.assertFalse(is_junk_title(title))

    def test_fixed_quote_page_titles_are_junk(self):
        for title in (*QUOTE_PAGES, "SOXL Holdings - Yahoo Finance", "SOXL Option Chain | Yahoo Finance",
                      "Direxion Daily Semiconductor Bull 3X Shares (SOXL) Options Chain - Yahoo Finance",
                      "AAPL Stock Price | Apple Inc. Stock Quote (U.S.: Nasdaq) | MarketWatch",
                      "SOXL Stock Price and Chart — AMEX:SOXL", "삼성전자 주식 가격 및 차트 — KRX:005930 — TradingView"):
            with self.subTest(title=title):
                self.assertTrue(is_junk_title(title))

    def test_headlines_using_quote_page_words_are_kept(self):
        for title in (
            "Berkshire trims Apple (AAPL) holdings", "Top 10 holdings of the ARK Innovation ETF",
            "SoftBank Group Holdings shares surge", "HSBC Holdings profit beats estimates",
            "Unusual activity in the Tesla (TSLA) options chain", "Company profile: how Nvidia built its AI lead",
            "Tesla stock quote: shares fall 3%", "Apple (NASDAQ: AAPL) unveils new iPhone",
            "Nvidia price and chart pattern signal breakout", "Fed holds rates — NYSE reacts",
        ):
            with self.subTest(title=title):
                self.assertFalse(is_junk_title(title))

    def test_placeholder_rule_drops_template_tokens_but_keeps_underscored_words(self):
        for title in ("article_title", "[ARTICLE_TITLE]", " META_TITLE_QUOTE. ", "— og_title —",
                      f"{PLACEHOLDER} | Yahoo Finance", "속보: NEWS_HEADLINE_1 발표"):
            with self.subTest(junk=title):
                self.assertTrue(is_junk_title(title))
        for title in ("OpenAI's GPT_5 launch lifts Microsoft", "ESG_2026 report shows record inflows",
                      "COVID_19 cases rise again in Asia", "GPT_5 출시에 마이크로소프트 강세"):
            with self.subTest(kept=title):
                self.assertFalse(is_junk_title(title))

    def test_section_landing_pages_are_junk_but_headlines_about_them_are_kept(self):
        for title in ("Latest Stock Market News", "latest stock market news ", "Top Stories", "Markets"):
            with self.subTest(junk=title):
                self.assertTrue(is_junk_title(title))
        for title in ("Stock market news today: Dow falls as yields climb",
                      "Latest stock market news: Nvidia leads chip rally", "Markets brace for Fed decision"):
            with self.subTest(kept=title):
                self.assertFalse(is_junk_title(title))

    def test_long_feed_titles_are_checked_in_linear_time(self):
        # 대문자 조각이 길게 이어지다 소문자로 끝나면 이전 정규식은 역추적으로 수 초가 걸렸다.
        hostile = "x " + "A1_" * 2000 + "Ab"
        started = datetime.now()
        self.assertFalse(is_junk_title(hostile))
        self.assertTrue(is_junk_title(hostile + " META_TITLE"))
        is_junk_title("A" * 40000)                       # 거래소 코드 패턴도 길이를 묶었다
        is_junk_title("AB:" * 10000)
        self.assertLess((datetime.now() - started).total_seconds(), 0.5)

    def test_one_letter_tickers_need_a_word_to_count_as_headlines(self):
        for title in ("X", "F", "F -"):
            with self.subTest(junk=title):
                self.assertTrue(is_junk_title(title))
        for title in ("X jumps 5% after U.S. Steel deal", "F, GM rally on EV tax credit", "C 주가 급등", "F stock"):
            with self.subTest(kept=title):
                self.assertFalse(is_junk_title(title))


class StockNewsTest(unittest.TestCase):
    def test_option_and_placeholder_pages_are_skipped_and_limit_is_backfilled(self):
        at = gmt(EVENING)
        payload = rss([
            (f"{OPTION_PAGE} - Yahoo Finance", "Yahoo Finance", "https://example.com/opt", at),
            (f"{PLACEHOLDER} - Yahoo Finance", "Yahoo Finance", "https://example.com/meta", at),
            ("SOXL jumps as chip stocks rally - Reuters", "Reuters", "https://example.com/one", at),
            ("Semiconductor ETFs extend gains - CNBC", "CNBC", "https://example.com/two", at),
            ("Third story - CNBC", "CNBC", "https://example.com/three", at),
        ])
        with patch.object(N.urllib.request, "urlopen", return_value=io.BytesIO(payload)):
            rows = N.fetch_news("미국", "SOXL", limit=2)
        self.assertEqual([row["title"] for row in rows],
                         ["SOXL jumps as chip stocks rally", "Semiconductor ETFs extend gains"])

    def test_quote_pages_from_any_site_are_skipped(self):
        at = gmt(EVENING)
        sources = ["Yahoo Finance"] * 4 + ["MarketWatch", "TradingView"]
        payload = rss([
            *((f"{page} - {source}", source, f"https://example.com/page{index}", at)
              for index, (page, source) in enumerate(zip(QUOTE_PAGES, sources))),
            ("Berkshire trims Apple (AAPL) holdings - Reuters", "Reuters", "https://example.com/one", at),
            ("OpenAI's GPT_5 launch lifts Microsoft - CNBC", "CNBC", "https://example.com/two", at),
        ])
        with patch.object(N.urllib.request, "urlopen", return_value=io.BytesIO(payload)):
            rows = N.fetch_news("미국", "SOXL")
        self.assertEqual([row["title"] for row in rows],
                         ["Berkshire trims Apple (AAPL) holdings", "OpenAI's GPT_5 launch lifts Microsoft"])


class BriefingTitleTest(unittest.TestCase):
    def setUp(self):
        B._cache.clear()
        D._CACHE.clear()
        D._AI_ATTEMPTS.clear()
        self.addCleanup(B._cache.clear)
        for guard in (patch.object(D, "_ask", side_effect=AssertionError("AI path called")),
                      patch.dict(os.environ, {"GEMINI_API_KEY": ""})):
            guard.start()
            self.addCleanup(guard.stop)

    def feed(self):
        at = EVENING.replace(hour=16, minute=58)
        entries = [(f"{PLACEHOLDER} - Yahoo Finance", "Yahoo Finance", "https://example.com/meta", gmt(at)),
                   (f"{OPTION_PAGE} - Yahoo Finance", "Yahoo Finance", "https://example.com/opt", gmt(at))]
        entries += [(title, f"Source {index}", f"https://example.com/{index}", gmt(at - timedelta(minutes=index + 1)))
                    for index, title in enumerate(GOOD_TITLES)]
        return rss(entries)

    def test_digest_feed_parser_drops_placeholder_title(self):
        with patch.object(D.urllib.request, "urlopen", return_value=io.BytesIO(self.feed())):
            rows = D._fetch_feed(("Google News", "US", "https://news.google.com/rss"))
        self.assertEqual([row["title"] for row in rows], GOOD_TITLES)

    def test_live_evening_briefing_skips_junk_and_keeps_remaining_items(self):
        payload = self.feed()
        with patch.object(D.urllib.request, "urlopen", side_effect=lambda *args, **kwargs: io.BytesIO(payload)):
            result = B.get_public_briefing("evening", now=EVENING)
        titles = [item["title"] for item in result["items"]]
        self.assertTrue(result["available"])
        self.assertNotIn(PLACEHOLDER, titles)
        self.assertFalse(any(is_junk_title(title) for title in titles))
        self.assertEqual(len(titles), len(GOOD_TITLES))

    def snapshot(self, titles):
        """Cache a noon snapshot of 2026-10-31, as an earlier visitor would have."""
        noon = EVENING.replace(hour=12, minute=30)
        articles = [{"id": str(index), "title": title, "source": f"Source {index}", "_market": "KR" if index < 2 else "US",
                     "url": f"https://example.com/{index}",
                     "publishedAt": (noon - timedelta(minutes=index)).isoformat()} for index, title in enumerate(titles)]
        with patch.object(B, "_collect_sources", return_value=(articles, [])):
            built = B.get_public_briefing("noon", now=noon)
        return noon, built, B._cache[(EVENING.date().isoformat(), "noon")][1]

    def test_cached_snapshot_with_junk_is_cleaned_when_served(self):
        day = EVENING.date()
        noon, built, stored = self.snapshot(GOOD_TITLES)
        # A snapshot cached by a build from before the title filter existed.
        stored["items"].insert(0, {"id": "meta", "title": PLACEHOLDER, "source": "Yahoo Finance",
                                   "url": "https://example.com/meta", "publishedAt": noon.isoformat(),
                                   "previousWindow": True})
        stored["backfillCount"] += 1
        stored["backfillStart"] = (noon - timedelta(hours=24)).isoformat()
        with patch.object(B, "_collect_sources", side_effect=AssertionError("archives never refetch")):
            archived = B.get_public_briefing("noon", day, now=EVENING)
        self.assertTrue(archived["available"])
        self.assertEqual(len(built["items"]), len(GOOD_TITLES))
        self.assertEqual(archived["items"], built["items"])
        self.assertEqual(archived["backfillCount"], 0)
        self.assertIsNone(archived["backfillStart"])
        self.assertEqual(B._cache[(day.isoformat(), "noon")][1]["items"][0]["title"], PLACEHOLDER)

    def test_cached_snapshot_with_only_junk_becomes_unavailable(self):
        _, _, stored = self.snapshot(GOOD_TITLES[:1])
        stored["items"][0]["title"] = PLACEHOLDER
        archived = B.get_public_briefing("noon", EVENING.date(), now=EVENING)
        self.assertFalse(archived["available"])
        self.assertEqual(archived["items"], [])
        self.assertEqual(archived["retryAfter"], B.FAILURE_COOLDOWN)


class DigestLedgerTitleTest(unittest.TestCase):
    def setUp(self):
        D._CACHE.clear()
        D._AI_ATTEMPTS.clear()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "notifications.sqlite"
        for guard in (patch.object(D, "_cache_path", return_value=self.path),
                      patch.dict(os.environ, {"GEMINI_API_KEY": ""}),
                      patch.object(D.urllib.request, "urlopen", side_effect=AssertionError("unexpected network"))):
            guard.start()
            self.addCleanup(guard.stop)

    def test_stored_digest_with_junk_is_cleaned_after_restart_without_refetch(self):
        now = EVENING
        good = {"id": "fed", "title": GOOD_TITLES[3], "source": "CNBC", "_market": "US",
                "url": "https://example.com/fed", "publishedAt": (now - timedelta(hours=1)).isoformat()}
        with patch.object(D, "_collect", return_value=([good], [])) as collect:
            first = D.build_digest("evening", now)
        # Simulate a ledger row written before the title filter existed.
        junk = {"id": "meta", "title": PLACEHOLDER, "source": "Yahoo Finance",
                "url": "https://example.com/meta", "publishedAt": (now - timedelta(minutes=30)).isoformat()}
        items = [junk, *first["items"]]
        start = datetime.fromisoformat(first["windowStart"])
        stored = {**first, "items": items, "text": D._render(first["headline"], first["summary"], items, start, now, False)}
        with closing(sqlite3.connect(str(self.path))) as db, db:
            db.execute("UPDATE market_digest_cache SET result = ? WHERE cache_key = ?",
                       (json.dumps(stored, ensure_ascii=False), f"{now.date().isoformat()}|evening"))
        D._CACHE.clear()  # process restart
        with patch.object(D, "_collect", side_effect=AssertionError("stored digest must not refetch")):
            second = D.build_digest("evening", now + timedelta(minutes=5))
        self.assertEqual(collect.call_count, 1)
        self.assertTrue(second["available"])
        self.assertEqual([item["id"] for item in second["items"]], ["fed"])
        self.assertNotIn(PLACEHOLDER, second["text"])
        self.assertEqual(second["text"], first["text"])


if __name__ == "__main__":
    unittest.main()
