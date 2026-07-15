"""네이버 종목 재무 — 클라우드(Render)에서 yfinance가 야후에 차단될 때의 국내 대안.

m.stock.naver.com 모바일 API로 PER·PBR·EPS·BPS·배당·시총·추정PER/EPS 를 가져온다.
표준 라이브러리만 사용.
"""

import json
import re
import urllib.request


def _api(code: str, path: str = "integration") -> dict:
    req = urllib.request.Request(
        f"https://m.stock.naver.com/api/stock/{code}/{path}",
        headers={"User-Agent": "Mozilla/5.0", "Referer": "https://m.stock.naver.com/"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def _num(s) -> float | None:
    if s is None:
        return None
    m = re.search(r"-?\d[\d,]*\.?\d*", str(s))
    return float(m.group().replace(",", "")) if m else None


def _won(s) -> float | None:
    """'1,622조 3,423억' → 숫자."""
    if s is None:
        return None
    txt = str(s).replace(",", "").replace(" ", "")
    total = 0.0
    found = False
    for pat, mul in ((r"(\d+\.?\d*)조", 1e12), (r"(\d+\.?\d*)억", 1e8)):
        m = re.search(pat, txt)
        if m:
            total += float(m.group(1)) * mul
            found = True
    if not found:
        m = re.search(r"(\d+\.?\d*)", txt)
        if m:
            total = float(m.group(1))
    return total or None


def naver_fundamentals(code: str) -> dict:
    """국내 종목 재무 지표 + 애널리스트 컨센서스. ROE는 EPS/BPS로 근사."""
    d = _api(code)
    info = {r.get("code"): r.get("value") for r in (d.get("totalInfos") or [])}
    ci = d.get("consensusInfo") or {}
    eps = _num(info.get("eps"))
    bps = _num(info.get("bps"))
    return {
        "name": d.get("stockName"),
        "per": _num(info.get("per")),
        "pbr": _num(info.get("pbr")),
        "eps": eps,
        "bps": bps,
        "roe": (eps / bps) if (eps and bps) else None,  # 근사
        "divYield": _num(info.get("dividendYieldRatio")),
        "dividend": _num(info.get("dividend")),  # 주당배당금(연간)
        "marketCap": _won(info.get("marketValue")),
        "cnsPer": _num(info.get("cnsPer")),  # 추정 PER (컨센서스)
        "cnsEps": _num(info.get("cnsEps")),  # 추정 EPS
        "target": _num(ci.get("priceTargetMean")),  # 목표주가 평균
        "recomm": _num(ci.get("recommMean")),  # 투자의견 평균 (높을수록 매수)
    }


def naver_profile(code: str) -> dict:
    """종목 프로필 — 개요(주로 ETF), 로고, 최근 증권사 리포트."""
    d = _api(code)
    researches = []
    for r in (d.get("researches") or [])[:5]:
        wdt = str(r.get("wdt") or "")
        pub = f"{wdt[:4]}-{wdt[4:6]}-{wdt[6:]}" if len(wdt) == 8 else wdt
        researches.append({"title": r.get("tit"), "brokerage": r.get("bnm"), "date": pub})

    logo = None
    try:
        b = _api(code, "basic")
        logo = b.get("itemLogoPngUrl") or b.get("itemLogoUrl")
    except Exception:
        pass

    return {
        "name": d.get("stockName"),
        "description": d.get("description"),  # ETF/ETN 상품 개요 (주식은 대개 None)
        "logo": logo,
        "researches": researches,
    }
