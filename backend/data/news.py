"""뉴스 수집 — 구글뉴스 RSS.

종목명으로 검색해 최신 기사 목록을 반환한다.
국내는 한국어(ko/KR), 미국은 영어(en/US) 기사로 검색.
표준 라이브러리만 사용(urllib + xml.etree) — 추가 설치 불필요.
"""

import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

_KST = timezone(timedelta(hours=9))

# 기사 대신 섞여 들어오는 제목들. 정상 헤드라인(한글, 티커, S&P 500, AI, 숫자)이
# 걸리지 않도록 기사 제목에는 나오지 않는 형태만 잡는다.
# - 렌더링 안 된 템플릿 자리표시자: 제목 전체가 토큰 하나('[article_title]')이거나,
#   대문자 조각이 둘 이상인 토큰(META_TITLE_QUOTE, NEWS_HEADLINE_1)·{{title}}·${title}이
#   들어 있으면 버린다. 'GPT_5', 'ESG_2026'처럼 대문자 조각이 하나뿐이면 기사로 본다.
_TEMPLATE_TOKEN = re.compile(r"\W*[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\W*")
# 외부 피드 제목에 정규식 역추적이 걸리지 않도록 토큰을 나눠 선형으로 검사한다.
_WORD = re.compile(r"[A-Za-z0-9_]+")
_UPPER_PART = re.compile(r"[A-Z0-9]+")
_TEMPLATE_BRACES = re.compile(r"\{\{|\}\}|\$\{")
_PLACEHOLDER_TITLES = {"untitled", "null", "none", "undefined", "제목 없음"}
# - 기사 대신 잡히는 섹션 첫 화면('Latest Stock Market News - Yahoo Finance'). 제목 전체가
#   정확히 같을 때만 버리므로 'Stock market news today: Dow falls'는 남는다.
_SECTION_TITLES = {"latest stock market news", "stock market news", "latest news", "top stories",
                   "market news", "markets", "breaking news", "stock market today", "news"}
# - 시세·차트·옵션 계약 페이지(야후 파이낸스, 마켓워치, 트레이딩뷰 등). 옵션 계약은
#   'SOXL Oct 2026 162.500 put (SOXL261030P00162500)' 꼴이다. 마켓워치는
#   'Stock Quote (U.S.: NYSE Arca)', 트레이딩뷰는 'Stock Price and Chart — AMEX:SOXL'.
#   거래소·종목 코드는 길이를 묶어 긴 대문자 제목에서 역추적이 커지지 않게 한다.
_QUOTE_PAGE = re.compile(
    r"stock price,? news,? quote|quote\s*&\s*history|historical prices\s*&\s*data|"
    r"interactive stock chart|실시간\s*시세\s*조회|"
    r"company profile\s*&\s*facts|valuation measures\s*&\s*financial statistics|"
    r"\bstock quote\s*\([^():]{1,40}:[^()]{1,40}\)|"
    r"\bprice and chart\s*[—–-]\s*(?-i:[A-Z][A-Z0-9_]{0,15}:[A-Z0-9][A-Z0-9._!]{0,15})|"
    r"(?-i:[A-Z][A-Z0-9_]{0,15}:[A-Z0-9][A-Z0-9._!]{0,15})\s*[—–-]\s*tradingview\b|"
    r"\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{4}\s+\d+\.\d{3}\s+(?:call|put)\b",
    re.IGNORECASE,
)
# - 야후 종목 하위 페이지: 'Direxion ... (SOXL) Options Chain', 'SOXL Holdings'. 'holdings'·
#   'options chain'은 기사에도 나오므로 티커 바로 뒤에서 제목이 끝나는 꼴만 잡는다.
_TICKER = r"\^?[A-Z0-9][A-Z0-9.=-]{0,11}"
_TICKER_PAGE = re.compile(
    rf"(?:\({_TICKER}\)|^{_TICKER})\s+Options? Chain(?:\s+[-|]\s+Yahoo Finance)?$"
    rf"|^{_TICKER}\s+Holdings(?:\s+[-|]\s+Yahoo Finance)?$"
)
_OPTION_SYMBOL = re.compile(r"\b[A-Z]{1,6}\d{6}[CP]\d{8}\b")


def _has_placeholder(title: str) -> bool:
    """대문자 조각이 둘 이상인 토큰(META_TITLE_QUOTE)이나 {{ }}·${ 가 있으면 True."""
    if _TEMPLATE_BRACES.search(title):
        return True
    for token in _WORD.findall(title):
        if "_" not in token:
            continue
        parts = token.split("_")
        if all(_UPPER_PART.fullmatch(p) for p in parts) and sum(p[0].isalpha() for p in parts) >= 2:
            return True
    return False


def is_junk_title(title: str) -> bool:
    """기사가 아닌 제목(빈 제목·자리표시자·시세 페이지)이면 True. 뉴스·브리핑 공용."""
    title = " ".join((title or "").split())
    # 글자가 없거나 두 자도 안 되면('-', '…', '1', 'X') 헤드라인이 아니다.
    # 한 글자 티커도 단어가 붙으면('X jumps 5%', 'F 주가 급등') 기사로 남긴다.
    if not any(c.isalpha() for c in title) or sum(c.isalnum() for c in title) < 2:
        return True
    if title.casefold() in _PLACEHOLDER_TITLES | _SECTION_TITLES or _TEMPLATE_TOKEN.fullmatch(title):
        return True
    return bool(_has_placeholder(title) or _QUOTE_PAGE.search(title) or _TICKER_PAGE.search(title)
                or _OPTION_SYMBOL.search(title))


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
    for item in root.findall(".//item"):
        if len(out) >= limit:
            break
        title = item.findtext("title", "") or ""
        src_el = item.find("source")
        source = src_el.text if src_el is not None and src_el.text else ""
        # 구글뉴스 제목 끝의 ' - 언론사' 꼬리표 제거
        if source and title.endswith(f" - {source}"):
            title = title[: -len(f" - {source}")]
        # 시세·옵션 페이지나 자리표시자는 건너뛰고 다음 기사로 limit을 채운다.
        if is_junk_title(title):
            continue
        out.append({
            "title": title,
            "link": item.findtext("link", "") or "",
            "source": source,
            "published": _fmt_date(item.findtext("pubDate", "")),
        })
    return out
