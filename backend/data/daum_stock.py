"""KRX 정규장 종가. 야간 알림의 기준가는 장후 거래 중에도 고정한다."""

import math

import requests

from cache import ttl_cache


@ttl_cache(60)
def last_regular_close(ticker: str) -> float | None:
    symbol = f"A{ticker}"
    try:
        response = requests.get(
            f"https://finance.daum.net/api/quotes/{symbol}",
            headers={"Referer": f"https://finance.daum.net/quotes/{symbol}",
                     "User-Agent": "Mozilla/5.0"},
            timeout=6,
        )
        response.raise_for_status()
        quote = response.json()
    except (requests.RequestException, ValueError):
        return None
    if not isinstance(quote, dict) or quote.get("symbolCode") != symbol:
        return None

    # Daum supplies an after-market comparison only once the regular close is fixed.
    if quote.get("afterMarketChangePrice") is not None or quote.get("isClosing") is True:
        price = quote.get("regularTradePrice")
    elif quote.get("isClosing") is False:
        price = quote.get("prevClosingPrice")
    else:
        return None
    if type(price) in (int, float) and math.isfinite(price) and price > 0:
        return float(price)
    return None
