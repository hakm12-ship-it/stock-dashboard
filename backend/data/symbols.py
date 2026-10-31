"""종목 마스터 — 이름 ↔ 코드 매핑.

상장목록을 불러와 (ticker, name) 표로 정규화한다. 국내는 FinanceDataReader,
미국은 FDR이 쓰는 네이버 API를 직접 병렬로 부른다.
네트워크 호출이므로 app 쪽에서 캐싱해 쓴다.
"""

import time
from concurrent.futures import ThreadPoolExecutor

import FinanceDataReader as fdr
import pandas as pd
import requests

from cache import PARTIAL

_NAVER_STOCKS = "https://api.stock.naver.com/stock/exchange/{}/marketValue"
_NAVER_US_ETF = "https://api.stock.naver.com/etf/priceTop"
_NAVER_HEADERS = {"User-Agent": "Mozilla/5.0"}
# 네이버가 받아주는 페이지 크기 상한 (넘으면 400).
_STOCK_PAGE_SIZE = 100
_ETF_PAGE_SIZE = 60
_MAX_PAGES = 200            # 응답이 이상해도 페이지를 끝없이 돌지 않게
_PAGE_TIMEOUT = (5, 10)     # (연결, 응답) 초. FDR은 제한이 없어 응답이 멈추면 검색도 멈췄다.
_PAGE_WORKERS = 8
_US_DEADLINE = 45           # 미국 목록 전체를 기다리는 최대 시간(초). 평소 약 12초.
_MIN_COVERAGE = 0.9         # 전체 수의 이만큼도 못 받으면 잘린 목록으로 보고 실패시킨다


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
        print(f"[symbols] {market} 목록을 불러오지 못했습니다: {exc!r}")
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
    df = df.drop_duplicates("ticker").reset_index(drop=True)
    if etf is None:
        df.attrs[PARTIAL] = "ETF/KR"    # 캐시가 온전한 이전 표를 이걸로 바꾸지 않게
    return df


def _naver_page(url: str, rows_key: str, page: int, size: int) -> tuple[int, int, list[dict]]:
    """네이버 상장목록 한 페이지 → (전체 종목 수, 받은 행 수, 티커·이름).

    한 페이지가 200KB 남짓이라 원본은 여기서 버리고 두 필드만 남긴다.
    순간 오류는 한 번 더 시도한다.
    """
    for attempt in range(2):
        try:
            r = requests.get(url, params={"page": page, "pageSize": size},
                             headers=_NAVER_HEADERS, timeout=_PAGE_TIMEOUT)
            r.raise_for_status()
            body = r.json()
            break
        except (requests.RequestException, ValueError):
            if attempt:
                raise
    raw = body.get(rows_key) or []
    rows = []
    for row in raw:
        # 클래스 주식은 "BRK B"처럼 공백이 든 코드로 온다. 앱·FDR(야후)은 BRK-B를 쓴다.
        code = "-".join(str(row.get("symbolCode") or "").split())
        # 영문명이 없는 행도 버리지 않는다 — 한글명으로라도 남겨야 티커로 찾힌다.
        name = row.get("stockNameEng") or row.get("stockName")
        if code and name:
            rows.append({"Symbol": code, "Name": name})
    return int(body["totalCount"]), len(raw), rows


def _naver_listing(url: str, rows_key: str, size: int, deadline: float) -> pd.DataFrame:
    """네이버 상장목록 전체 — FDR NaverStockListing과 같은 API·컬럼.

    FDR은 60개씩 한 페이지씩, 시간 제한 없이 받는다. 미국 전체가 약 215번
    왕복이라 검색 한 번이 34초 걸렸다. 첫 페이지의 전체 수로 페이지 수를
    정한 뒤 나머지를 병렬로 받고, deadline(time.monotonic 기준)을 넘기면 포기한다.
    """
    def until_deadline(future):
        return future.result(timeout=max(0.0, deadline - time.monotonic()))

    pool = ThreadPoolExecutor(max_workers=_PAGE_WORKERS, thread_name_prefix="symbols")
    try:
        total, got, rows = until_deadline(pool.submit(_naver_page, url, rows_key, 1, size))
        pages = min(_MAX_PAGES, -(-total // size))
        rest = [pool.submit(_naver_page, url, rows_key, p, size) for p in range(2, pages + 1)]
        for future in rest:
            _, n, page_rows = until_deadline(future)
            got += n
            rows += page_rows
    finally:
        # 실패·시간 초과면 남은 페이지는 버린다. 진행 중인 요청은 각자 timeout 안에 끝난다.
        pool.shutdown(wait=False, cancel_futures=True)
    if not rows:
        raise ValueError(f"빈 상장목록: {url}")
    if got < total * _MIN_COVERAGE:
        # 페이지 수는 요청한 pageSize로 계산한다. 네이버가 400 없이 더 적게 주면
        # 뒤쪽 종목이 조용히 빠진 채 하루 동안 캐시된다.
        raise ValueError(f"상장목록이 잘렸습니다: {url} {got}/{total}")
    return _normalize(pd.DataFrame(rows), ["Symbol"])


def us_symbols() -> pd.DataFrame:
    """미국 상장종목 (NASDAQ + NYSE) + 미국 ETF.

    NASDAQ/NYSE 목록에는 SPY·QQQ·SCHD 같은 NYSE Arca ETF가 없어서 따로 더한다.
    ETF가 실패하면 주식만 돌려주되 덜 받은 표(attrs[PARTIAL])로 표시한다.
    """
    deadline = time.monotonic() + _US_DEADLINE
    frames = [
        _naver_listing(_NAVER_STOCKS.format(m), "stocks", _STOCK_PAGE_SIZE, deadline)
        for m in ("NASDAQ", "NYSE")
    ]
    try:
        etf = _naver_listing(_NAVER_US_ETF, "etfs", _ETF_PAGE_SIZE, deadline)
        frames.append(etf)
    except Exception as exc:  # noqa: BLE001 - ETF가 실패해도 주식 검색은 살아 있어야 한다
        # 시간 초과는 str()이 빈 문자열이라 repr로 남긴다.
        print(f"[symbols] ETF/US 목록을 불러오지 못했습니다: {exc!r}")
        etf = None
    df = pd.concat(frames).drop_duplicates("ticker").reset_index(drop=True)
    if etf is None:
        df.attrs[PARTIAL] = "ETF/US"    # 캐시가 온전한 이전 표를 이걸로 바꾸지 않게
    return df


def symbols(market: str) -> pd.DataFrame:
    """시장 이름('한국'/'미국')으로 종목표를 반환."""
    return krx_symbols() if market == "한국" else us_symbols()
