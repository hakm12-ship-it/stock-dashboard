"""뉴스 수집 — 구글뉴스 RSS.

종목명으로 검색해 최신 기사 목록을 반환한다.
국내는 한국어(ko/KR), 미국은 영어(en/US) 기사로 검색.
표준 라이브러리만 사용(urllib + xml.etree) — 추가 설치 불필요.
"""

import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

_KST = timezone(timedelta(hours=9))


def _fmt_date(s: str) -> str:
    """RSS pubDate('Mon, 14 Jul 2026 07:00:00 GMT') → 'YYYY-MM-DD HH:MM' (KST)."""
    try:
        dt = datetime.strptime(s, "%a, %d %b %Y %H:%M:%S %Z")
        return dt.replace(tzinfo=timezone.utc).astimezone(_KST).strftime("%Y-%m-%d %H:%M")
    except (ValueError, TypeError):
        return s or ""


def fetch_news(market: str, name: str, limit: int = 15) -> list[dict]:
    """종목명으로 최신 뉴스 [{title, link, source, published}] 반환."""
    if market == "한국":
        query, hl, gl, ceid = f"{name} 주가", "ko", "KR", "KR:ko"
    else:
        query, hl, gl, ceid = f"{name} stock", "en", "US", "US:en"

    url = (
        "https://news.google.com/rss/search?"
        f"q={urllib.parse.quote(query)}&hl={hl}&gl={gl}&ceid={ceid}"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        root = ET.fromstring(resp.read())

    out = []
    for item in root.findall(".//item")[:limit]:
        title = item.findtext("title", "") or ""
        src_el = item.find("source")
        source = src_el.text if src_el is not None and src_el.text else ""
        # 구글뉴스 제목 끝의 ' - 언론사' 꼬리표 제거
        if source and title.endswith(f" - {source}"):
            title = title[: -len(f" - {source}")]
        out.append({
            "title": title,
            "link": item.findtext("link", "") or "",
            "source": source,
            "published": _fmt_date(item.findtext("pubDate", "")),
        })
    return out
