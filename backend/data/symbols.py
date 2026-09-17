"""종목 마스터 — 이름 ↔ 코드 매핑.

FinanceDataReader의 상장목록을 불러와 (ticker, name) 표로 정규화한다.
네트워크 호출이므로 app 쪽에서 캐싱해 쓴다.
"""

import FinanceDataReader as fdr
import pandas as pd


def _pick(df: pd.DataFrame, candidates: list[str]) -> str:
    """후보 컬럼명 중 실제 존재하는 것을 고른다 (라이브러리 버전차 흡수)."""
    for c in candidates:
        if c in df.columns:
            return c
    raise KeyError(f"컬럼을 찾을 수 없음: {candidates} / 실제: {list(df.columns)}")


def _normalize(df: pd.DataFrame, code_cands: list[str]) -> pd.DataFrame:
    code = _pick(df, code_cands)
    name = _pick(df, ["Name"])
    out = df[[code, name]].rename(columns={code: "ticker", name: "name"})
    out["ticker"] = out["ticker"].astype(str).str.strip()
    out["name"] = out["name"].astype(str).str.strip()
    return out.dropna().query("ticker != '' and name != ''")


def _optional_listing(market: str, code_cands: list[str]) -> pd.DataFrame | None:
    """ETF 목록처럼 없어도 되는 상장표. 실패해도 주식 검색은 살아 있어야 한다."""
    try:
        return _normalize(fdr.StockListing(market), code_cands)
    except Exception as exc:  # noqa: BLE001 - 외부 데이터 소스 실패는 검색 자체를 막지 않는다
        print(f"[symbols] {market} 목록을 불러오지 못했습니다: {exc}")
        return None


def krx_symbols() -> pd.DataFrame:
    """국내 상장종목 (KOSPI/KOSDAQ) + 국내 ETF. 코드는 6자리 0-패딩.

    StockListing("KRX")에는 ETF가 없어서 KODEX·TIGER 같은 종목이 검색되지 않았다.
    """
    frames = [_normalize(fdr.StockListing("KRX"), ["Code", "Symbol"])]
    etf = _optional_listing("ETF/KR", ["Symbol", "Code"])
    if etf is not None:
        frames.append(etf)
    df = pd.concat(frames)
    df["ticker"] = df["ticker"].str.zfill(6)
    return df.drop_duplicates("ticker").reset_index(drop=True)


def us_symbols() -> pd.DataFrame:
    """미국 상장종목 (NASDAQ + NYSE) + 미국 ETF.

    NASDAQ/NYSE 목록에는 SPY·QQQ·SCHD 같은 NYSE Arca ETF가 없어서 따로 더한다.
    """
    frames = [
        _normalize(fdr.StockListing(m), ["Symbol", "Code"])
        for m in ("NASDAQ", "NYSE")
    ]
    etf = _optional_listing("ETF/US", ["Symbol", "Code"])
    if etf is not None:
        frames.append(etf)
    return pd.concat(frames).drop_duplicates("ticker").reset_index(drop=True)


def symbols(market: str) -> pd.DataFrame:
    """시장 이름('한국'/'미국')으로 종목표를 반환."""
    return krx_symbols() if market == "한국" else us_symbols()
