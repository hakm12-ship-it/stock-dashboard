"""네이버 실시간 국내 지수 — FDR/yfinance가 지수를 늦게 갱신하는 문제 보완.

KOSPI/KOSDAQ 현재값을 실시간(delayTime 0)으로 가져온다.
"""

import json
import urllib.request

_URL = "https://polling.finance.naver.com/api/realtime/domestic/index/{}"
_UP_CODES = {"1", "2"}  # 상한, 상승


def _num(s) -> float:
    return float(str(s).replace(",", ""))


def realtime_index(code: str) -> dict:
    """{last, change, changePct} — code는 'KOSPI' | 'KOSDAQ'."""
    req = urllib.request.Request(
        _URL.format(code),
        headers={"User-Agent": "Mozilla/5.0", "Referer": "https://finance.naver.com/"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())
    d = data["datas"][0]
    sign = 1 if d["compareToPreviousPrice"]["code"] in _UP_CODES else -1
    return {
        "last": _num(d["closePrice"]),
        "change": sign * abs(_num(d["compareToPreviousClosePrice"])),
        "changePct": sign * abs(_num(d["fluctuationsRatio"])),
    }


def realtime_quote(code: str) -> dict:
    """국내 개별 종목 실시간 시세.

    반환: {last, changePct, highPct, lowPct, marketOpen}.
    지수/선물은 realtime_index, 개별 종목은 이쪽.

    highPct·lowPct는 **당일 고가·저가**의 전일종가 대비 등락률이다. 알림이
    "오늘 이미 밟은 계단"을 다시 알리지 않으려면 이게 필요하다 — 상태를
    메모리에만 두면 재시작 때 날아가는데, 이 값은 시세에서 언제든 복원된다.
    """
    req = urllib.request.Request(
        f"https://polling.finance.naver.com/api/realtime/domestic/stock/{code}",
        headers={"User-Agent": "Mozilla/5.0", "Referer": "https://m.stock.naver.com/"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())
    d = data["datas"][0]
    sign = 1 if d["compareToPreviousPrice"]["code"] in _UP_CODES else -1
    last = _num(d["closePrice"])
    # 전일종가는 따로 안 주고 '현재가 - 전일대비'로 얻는다.
    prev = last - _num(d.get("compareToPreviousClosePrice", 0))
    pct = lambda p: (p / prev - 1) * 100 if prev else 0.0  # noqa: E731
    return {
        "last": last,
        "changePct": sign * abs(_num(d["fluctuationsRatio"])),
        "highPct": pct(_num(d.get("highPrice", 0))) if d.get("highPrice") else None,
        "lowPct": pct(_num(d.get("lowPrice", 0))) if d.get("lowPrice") else None,
        "marketOpen": d.get("marketStatus") == "OPEN",
    }
