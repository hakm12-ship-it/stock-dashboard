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
