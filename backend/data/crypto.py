"""업비트 공개 API — 코인 급등/급락 상위 (KRW 마켓, 24h 기준)."""

import json
import urllib.request


def _get(url: str):
    req = urllib.request.Request(
        url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def upbit_top(direction: str, size: int = 5) -> list[dict]:
    names = {
        m["market"]: m.get("korean_name") or m["market"]
        for m in _get("https://api.upbit.com/v1/market/all?is_details=false")
    }
    tickers = _get("https://api.upbit.com/v1/ticker/all?quote_currencies=KRW")
    tickers.sort(key=lambda x: x.get("signed_change_rate") or 0, reverse=(direction != "down"))
    out = []
    for x in tickers[:size]:
        code = str(x.get("market", "")).replace("KRW-", "")
        out.append({
            "ticker": code,
            "name": names.get(x.get("market"), code),
            "price": x.get("trade_price"),
            "changePct": (x.get("signed_change_rate") or 0) * 100,
        })
    return out
