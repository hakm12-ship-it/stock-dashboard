"""시장 전반 — 지수, 환율·유가, 급등락 TOP, 업종·테마, 뉴스."""

from fastapi import APIRouter

from deps import (
    INDEX_TICKERS,
    cached_crypto_top,
    cached_group_stocks,
    cached_groups,
    cached_market_rank,
    cached_naver_index,
    cached_news,
    change_of,
    load,
    load_fx,
    load_fx_hist,
    load_index,
    load_wti,
    market_name,
)

router = APIRouter()


@router.get("/api/news")
def api_news(market: str, name: str):
    return cached_news(market_name(market), name)


@router.get("/api/market-top")
def api_market_top(direction: str = "up", market: str = "KOSPI"):
    d = "down" if direction == "down" else "up"
    m = market.upper() if market.upper() in ("KOSPI", "KOSDAQ", "NASDAQ", "NYSE", "CRYPTO") else "KOSPI"
    try:
        if m == "CRYPTO":
            return cached_crypto_top(d)
        return cached_market_rank(d, m)
    except Exception:
        return []


@router.get("/api/groups")
def api_groups(kind: str = "industry"):
    k = "theme" if kind == "theme" else "industry"
    try:
        return cached_groups(k)
    except Exception:
        return []


@router.get("/api/group-stocks")
def api_group_stocks(no: int, kind: str = "industry"):
    k = "theme" if kind == "theme" else "industry"
    try:
        return cached_group_stocks(k, no)
    except Exception:
        return []


@router.get("/api/index")
def api_index(name: str):
    code = INDEX_TICKERS.get(name.upper())
    if not code:
        return None
    df = load_index(code)
    close = df["Close"].dropna()
    last, prev = float(close.iloc[-1]), float(close.iloc[-2])
    change = last - prev
    pct = (change / prev * 100) if prev else 0
    # 국내 지수는 네이버 실시간으로 현재값 덮어쓰기 (FDR 지수 갱신 지연 보완)
    if name.upper() in ("KOSPI", "KOSDAQ"):
        try:
            rt = cached_naver_index(name.upper())
            last, change, pct = rt["last"], rt["change"], rt["changePct"]
        except Exception:
            pass
    return {
        "name": name.upper(), "last": last, "change": change, "changePct": pct,
        "series": [{"time": i.strftime("%Y-%m-%d"), "close": float(c)} for i, c in close.items()],
    }


@router.get("/api/fx-history")
def api_fx_history(period: str = "3m"):
    close = load_fx_hist(period)["Close"].dropna()
    return [{"time": i.strftime("%Y-%m-%d"), "rate": float(v)} for i, v in close.items()]


@router.get("/api/fx")
def api_fx():
    last, change, pct = change_of(load_fx()["Close"].dropna())
    return {"usdkrw": last, "change": change, "changePct": pct}


@router.get("/api/fx-attribution")
def api_fx_attribution(ticker: str, market: str, period: str = "3m"):
    """미국 자산의 원화 수익률을 주가 기여와 환율 기여로 분해.

    원화가치 = 달러가격 × 환율 이므로
    (1+원화수익) = (1+주가수익)(1+환율수익) — 교차항은 두 수익의 곱이다.
    """
    if market.upper() != "US":
        return {"available": False}
    try:
        price = load(ticker, period)["Close"].dropna()
        fx = load_fx_hist(period)["Close"].dropna()
    except Exception:
        return {"available": False}

    idx = price.index.intersection(fx.index)
    if len(idx) < 5:
        return {"available": False}
    p, f = price[idx], fx[idx]

    rp = float(p.iloc[-1] / p.iloc[0] - 1)
    rf = float(f.iloc[-1] / f.iloc[0] - 1)
    return {
        "available": True,
        "days": len(idx),
        "priceReturn": rp * 100,
        "fxReturn": rf * 100,
        "crossTerm": rp * rf * 100,
        "krwReturn": ((1 + rp) * (1 + rf) - 1) * 100,
        "fxStart": float(f.iloc[0]),
        "fxEnd": float(f.iloc[-1]),
    }


@router.get("/api/macro")
def api_macro():
    fx_last, fx_chg, fx_pct = change_of(load_fx()["Close"].dropna())
    wti_last, wti_chg, wti_pct = change_of(load_wti()["Close"].dropna())
    return {
        "usdkrw": {"last": fx_last, "change": fx_chg, "changePct": fx_pct},
        "wti": {"last": wti_last, "change": wti_chg, "changePct": wti_pct},
    }
