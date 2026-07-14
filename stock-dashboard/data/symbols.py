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


def krx_symbols() -> pd.DataFrame:
    """국내 상장종목 (KOSPI/KOSDAQ). 코드는 6자리 0-패딩."""
    df = _normalize(fdr.StockListing("KRX"), ["Code", "Symbol"])
    df["ticker"] = df["ticker"].str.zfill(6)
    return df.drop_duplicates("ticker").reset_index(drop=True)


def us_symbols() -> pd.DataFrame:
    """미국 상장종목 (NASDAQ + NYSE)."""
    frames = [
        _normalize(fdr.StockListing(m), ["Symbol", "Code"])
        for m in ("NASDAQ", "NYSE")
    ]
    return pd.concat(frames).drop_duplicates("ticker").reset_index(drop=True)


def symbols(market: str) -> pd.DataFrame:
    """시장 이름('한국'/'미국')으로 종목표를 반환."""
    return krx_symbols() if market == "한국" else us_symbols()
