"""Hyperliquid HIP-3(trade.xyz) perp 가격 — KRX 휴장 중에도 24시간 거래되는
삼성전자·SK하이닉스 합성 perp로 야간 가격 추정에 사용한다. 공개 API, 키 불필요.
"""

import time

import requests

_URL = "https://api.hyperliquid.xyz/info"
_DEX = "xyz"

_INTERVAL_MS = {
    "5m": 5 * 60_000, "15m": 15 * 60_000, "60m": 60 * 60_000, "1d": 24 * 60 * 60_000,
}
_INTERVAL_HYPE = {"5m": "5m", "15m": "15m", "60m": "1h", "1d": "1d"}

# 국내 티커 -> xyz dex의 perp 심볼
TICKER_TO_PERP = {
    "005930": "xyz:SMSN",
    "000660": "xyz:SKHX",
}


def fetch_perp_candles(perp: str, interval: str = "5m", bars: int = 288) -> list[dict]:
    """[{t(ms), o, h, l, c, v}] — perp: 'xyz:SKHX' 등."""
    hype_interval = _INTERVAL_HYPE.get(interval, "5m")
    span_ms = _INTERVAL_MS.get(interval, 5 * 60_000) * bars
    now = int(time.time() * 1000)
    body = {
        "type": "candleSnapshot",
        "req": {"coin": perp, "interval": hype_interval, "startTime": now - span_ms, "endTime": now},
    }
    r = requests.post(_URL, json=body, timeout=10)
    r.raise_for_status()
    return [
        {"t": c["t"], "o": float(c["o"]), "h": float(c["h"]), "l": float(c["l"]),
         "c": float(c["c"]), "v": float(c["v"])}
        for c in r.json()
    ]


def fetch_perp_prices() -> dict[str, float]:
    """{perp심볼: markPx(USD)} 전체 조회."""
    r = requests.post(_URL, json={"type": "metaAndAssetCtxs", "dex": _DEX}, timeout=10)
    r.raise_for_status()
    meta, ctxs = r.json()
    out = {}
    for u, ctx in zip(meta["universe"], ctxs):
        px = ctx.get("markPx")
        if px is not None:
            out[u["name"]] = float(px)
    return out
