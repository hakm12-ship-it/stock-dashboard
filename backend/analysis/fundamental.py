"""기본적 분석 — 밸류에이션 지표 & 재무 추이.

yfinance 하나로 한국(.KS/.KQ)·미국을 모두 처리한다.
yfinance가 PER/PBR을 직접 안 주는 종목(주로 국내)은 순이익·자본으로 계산한다.
"""

import functools

import pandas as pd
import yfinance as yf


def _safe_info(t: yf.Ticker) -> dict:
    try:
        return t.info or {}
    except Exception:
        return {}


@functools.lru_cache(maxsize=1024)
def _resolve(market: str, ticker: str):
    """(Ticker, 심볼, info) 반환. 국내는 .KS(코스피)→.KQ(코스닥) 순으로 탐색."""
    if market != "한국":
        t = yf.Ticker(ticker)
        return t, ticker, _safe_info(t)
    for suffix in (".KS", ".KQ"):
        t = yf.Ticker(ticker + suffix)
        info = _safe_info(t)
        if info.get("marketCap"):
            return t, ticker + suffix, info
    t = yf.Ticker(ticker + ".KS")
    return t, ticker + ".KS", _safe_info(t)


def _equity(t: yf.Ticker):
    """재무상태표에서 자기자본(가장 최근 값)을 찾는다."""
    try:
        bs = t.balance_sheet
    except Exception:
        return None
    for row in ("Stockholders Equity", "Common Stock Equity",
                "Total Equity Gross Minority Interest"):
        if row in bs.index:
            vals = bs.loc[row].dropna()
            if len(vals):
                return float(vals.iloc[0])
    return None


def valuation(market: str, ticker: str) -> dict:
    """밸류에이션 지표 딕셔너리. 값이 없으면 None."""
    t, symbol, info = _resolve(market, ticker)
    price = info.get("currentPrice") or info.get("regularMarketPrice")
    shares = info.get("sharesOutstanding")

    eps = info.get("trailingEps")
    if eps is None:
        ni = info.get("netIncomeToCommon")
        if ni and shares:
            eps = ni / shares

    per = info.get("trailingPE")
    if per is None and price and eps and eps > 0:
        per = price / eps

    pbr = info.get("priceToBook")
    if pbr is None:
        equity = _equity(t)
        if equity and shares and price:
            pbr = price / (equity / shares)

    return {
        "종목": info.get("longName") or ticker,
        "섹터": info.get("sector"),
        "통화": info.get("currency"),
        "PER": per,
        "PBR": pbr,
        "EPS": eps,
        "ROE": info.get("returnOnEquity"),      # 소수(0.18) — 표시 시 ×100
        "배당수익률": info.get("dividendYield"),  # 이미 % 단위
        "시가총액": info.get("marketCap"),
    }


def revenue_trend(market: str, ticker: str):
    """연간 매출·영업이익·순이익 추이 DataFrame (연도 인덱스). 없으면 None."""
    t, symbol, info = _resolve(market, ticker)
    try:
        fs = t.income_stmt
    except Exception:
        return None
    if fs is None or fs.empty:
        return None

    picks = {
        "매출": ("Total Revenue", "Operating Revenue"),
        "영업이익": ("Operating Income", "EBIT"),
        "순이익": ("Net Income", "Net Income Common Stockholders"),
    }
    cols = {}
    for label, keys in picks.items():
        for k in keys:
            if k in fs.index:
                cols[label] = fs.loc[k]
                break
    if not cols:
        return None

    df = pd.DataFrame(cols)
    df.index = [idx.year for idx in df.index]
    return df.sort_index()


def forward_pe(market: str, ticker: str) -> dict:
    """현재 PER + 미래 PER(올해·내년 컨센서스). 애널리스트 예상EPS만 사용."""
    t, symbol, info = _resolve(market, ticker)
    price = info.get("currentPrice") or info.get("regularMarketPrice")

    trailing = info.get("trailingPE")
    if trailing is None:
        eps = info.get("trailingEps")
        if eps is None:
            ni, sh = info.get("netIncomeToCommon"), info.get("sharesOutstanding")
            eps = (ni / sh) if (ni and sh) else None
        if price and eps and eps > 0:
            trailing = price / eps

    out = {"price": price, "trailing": trailing, "forward": []}
    try:
        ee = t.earnings_estimate
    except Exception:
        ee = None
    labels = {"0y": "올해(E)", "+1y": "내년(E)"}
    if ee is not None and not ee.empty and "avg" in ee.columns:
        for period, label in labels.items():
            if period in ee.index:
                eps = ee.loc[period, "avg"]
                if price and eps and eps > 0:
                    out["forward"].append(
                        {"period": label, "eps": float(eps), "per": float(price / eps)}
                    )
    return out
