"""Hyperliquid HIP-3(trade.xyz) perp 가격 — KRX 휴장 중에도 24시간 거래되는
삼성전자·SK하이닉스 합성 perp로 야간 가격 추정에 사용한다. 공개 API, 키 불필요.
"""

import requests

_URL = "https://api.hyperliquid.xyz/info"
_DEX = "xyz"

# 국내 티커 -> xyz dex의 perp 심볼
TICKER_TO_PERP = {
    "005930": "xyz:SMSN",
    "000660": "xyz:SKHX",
}


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
