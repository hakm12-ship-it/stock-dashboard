"""USD/KRW 일봉 날짜 — 영국 서머타임(BST) 동안 하루씩 앞당겨 붙던 문제.

야후 KRW=X 일봉은 런던 자정에 찍힌다. BST 동안 그 시각은 전날 23:00 UTC라서,
FDR처럼 UTC로 날짜만 남기면 월요일 환율이 일요일 행이 되고 금요일 행은 사라진다.
그러면 미국 종가와 날짜로 맞추는 환율 기여가 금요일을 빼고 다음날 환율을 쓴다.
타임스탬프는 2026년 10월 실제 응답과 같은 모양으로 만들고, 네트워크는 쓰지 않는다.
"""

from datetime import date, datetime, timezone
from unittest.mock import patch

import pandas as pd
import pytest

import deps
from routers import market

FDR_COLUMNS = ["Open", "High", "Low", "Close", "Volume", "Adj Close"]


def _chart(stamps_and_closes, tz="Europe/London"):
    """야후 차트 API result[0] 모양. stamps는 UTC ISO 문자열."""
    stamps = [int(pd.Timestamp(s, tz="UTC").timestamp()) for s, _ in stamps_and_closes]
    closes = [c for _, c in stamps_and_closes]
    return {
        "meta": {"exchangeTimezoneName": tz},
        "timestamp": stamps,
        "indicators": {
            "quote": [{
                "open": list(closes),
                "high": [c + 1 for c in closes],
                "low": [c - 1 for c in closes],
                "close": list(closes),
                "volume": [0] * len(closes),
            }],
            "adjclose": [{"adjclose": list(closes)}],
        },
    }


# BST가 10월 25일에 끝나기 전후 2주. 마지막은 토요일 새벽에 찍힌 최신 호가.
AUTUMN = [
    ("2026-10-15T23:00:00", 1340.95),  # 금 10-16 런던 자정 (BST)
    ("2026-10-18T23:00:00", 1333.43),  # 월 10-19
    ("2026-10-19T23:00:00", 1330.00),  # 화 10-20
    ("2026-10-20T23:00:00", 1323.94),  # 수 10-21
    ("2026-10-21T23:00:00", 1325.59),  # 목 10-22
    ("2026-10-22T23:00:00", 1325.99),  # 금 10-23
    ("2026-10-26T00:00:00", 1321.76),  # 월 10-26 (GMT)
    ("2026-10-27T00:00:00", 1324.77),
    ("2026-10-28T00:00:00", 1326.81),
    ("2026-10-29T00:00:00", 1340.34),  # 목 10-29
    ("2026-10-30T00:00:00", 1337.98),  # 금 10-30
    ("2026-10-31T03:30:51", 1335.10),  # 토요일 새벽의 최신 호가 → 금요일 세션
]

AUTUMN_DAYS = ["2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23",
               "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]


def _days(df):
    return [d.strftime("%Y-%m-%d") for d in df.index]


def test_bst_bars_get_their_london_date_and_no_weekend_rows_remain():
    chart = _chart(AUTUMN)
    # 같은 타임스탬프를 FDR처럼 UTC로 자르면 일요일 행이 생긴다 — 재현 데이터 확인.
    fdr_style = pd.to_datetime(chart["timestamp"], unit="s").normalize()
    assert 6 in set(fdr_style.weekday)

    df = deps._fx_bars(chart)

    assert _days(df) == AUTUMN_DAYS
    assert set(df.index.weekday) <= {0, 1, 2, 3, 4}
    assert {"2026-10-16", "2026-10-23", "2026-10-30"} <= set(_days(df))  # 금요일이 다 있다
    assert df.loc["2026-10-19", "Close"] == 1333.43  # 월요일 환율이 월요일 행에


def test_spring_boundary_keeps_friday_and_moves_monday_off_sunday():
    df = deps._fx_bars(_chart([
        ("2026-03-26T00:00:00", 1450.0),  # 목 (GMT)
        ("2026-03-27T00:00:00", 1451.0),  # 금 (GMT)
        ("2026-03-29T23:00:00", 1452.0),  # 월 03-30 런던 자정 (BST 시작 뒤)
        ("2026-03-30T23:00:00", 1453.0),  # 화 03-31
    ]))
    assert _days(df) == ["2026-03-26", "2026-03-27", "2026-03-30", "2026-03-31"]
    assert df.loc["2026-03-30", "Close"] == 1452.0


def test_live_quote_merges_into_its_session_instead_of_adding_a_row():
    df = deps._fx_bars(_chart(AUTUMN))
    friday = df.loc["2026-10-30"]
    assert friday["Close"] == 1335.10  # 최신 호가가 금요일 종가
    assert friday["Open"] == 1337.98  # 시가는 그날 첫 봉
    assert friday["High"] == 1338.98 and friday["Low"] == 1334.10

    # 평일 장중(BST): 자정 봉과 최신 호가 봉이 같은 날 한 행으로 합쳐진다.
    df = deps._fx_bars(_chart([
        ("2026-07-12T23:00:00", 1380.0),  # 월 07-13
        ("2026-07-13T23:00:00", 1381.0),  # 화 07-14 자정 봉
        ("2026-07-14T10:00:00", 1384.0),  # 화 07-14 11:00 BST 최신 호가
    ]))
    assert _days(df) == ["2026-07-13", "2026-07-14"]
    assert df.loc["2026-07-14", "Close"] == 1384.0


def test_sunday_evening_quote_belongs_to_monday():
    df = deps._fx_bars(_chart([
        ("2026-10-29T00:00:00", 1340.34),  # 목
        ("2026-10-30T00:00:00", 1337.98),  # 금
        ("2026-11-01T22:30:00", 1333.00),  # 일 22:30 GMT = 월 07:30 KST, 아시아 개장
    ]))
    assert _days(df) == ["2026-10-29", "2026-10-30", "2026-11-02"]
    last, change, _ = deps.change_of(df["Close"].dropna())
    assert last == 1333.00
    assert change == pytest.approx(1333.00 - 1337.98)  # 금요일 대비


def test_shape_matches_fdr_and_missing_values_stay_nan():
    chart = _chart(AUTUMN)
    chart["indicators"]["quote"][0]["close"][1] = None  # 야후가 가끔 빈 값을 준다
    df = deps._fx_bars(chart)
    assert list(df.columns) == FDR_COLUMNS
    assert isinstance(df.index, pd.DatetimeIndex) and df.index.tz is None
    assert df.index.is_unique and df.index.is_monotonic_increasing
    assert (df.index == df.index.normalize()).all()
    assert df.index.name is None
    assert pd.isna(df.loc["2026-10-19", "Close"])

    empty = deps._fx_bars({"meta": {}, "indicators": {"quote": [{}], "adjclose": [{}]}})
    assert empty.empty and list(empty.columns) == FDR_COLUMNS


class _Resp:
    def __init__(self, body):
        self.body = body

    def raise_for_status(self):
        pass

    def json(self):
        return self.body


def test_fetch_starts_a_day_early_and_trims_to_the_requested_london_date():
    calls = []

    def fake_get(url, **kwargs):
        calls.append((url, kwargs))
        return _Resp({"chart": {"result": [_chart(AUTUMN)]}})

    with patch.object(deps.requests, "get", side_effect=fake_get):
        df = deps._fx_daily(date(2026, 10, 19))

    # 월요일 봉은 일요일 23:00 UTC에 찍혀 있으니 그보다 앞에서 받아야 빠지지 않는다.
    assert _days(df) == AUTUMN_DAYS[1:]
    (url, kwargs), = calls
    assert url.endswith("/KRW=X")
    assert kwargs["params"]["period1"] == int(datetime(2026, 10, 18, tzinfo=timezone.utc).timestamp())
    assert kwargs["params"]["interval"] == "1d"
    assert kwargs["timeout"] is not None


def test_loaders_use_the_dated_fetch_with_their_windows():
    seen = []

    def fake_daily(start):
        seen.append(start)
        return deps._fx_bars(_chart(AUTUMN))

    with patch.object(deps, "_fx_daily", side_effect=fake_daily):
        assert _days(deps.load_fx.__wrapped__()) == AUTUMN_DAYS
        deps.load_fx_hist.__wrapped__("3m")
        deps.load_fx_hist.__wrapped__("1y")
    today = date.today()
    assert [(today - s).days for s in seen] == [30, 90, 365]


def test_fx_routes_compare_with_the_previous_trading_day_and_keep_fridays():
    fx = deps._fx_bars(_chart(AUTUMN))
    with patch.object(market, "load_fx", return_value=fx), \
            patch.object(market, "load_fx_hist", return_value=fx):
        now = market.api_fx()
        history = market.api_fx_history("1m")

    # 토요일에 봐도 최신 호가(금요일 세션)를 목요일 종가와 비교한다.
    assert now["usdkrw"] == 1335.10
    assert now["change"] == pytest.approx(1335.10 - 1340.34)
    times = [p["time"] for p in history]
    assert times == AUTUMN_DAYS
    assert all(pd.Timestamp(t).weekday() < 5 for t in times)


def test_fx_attribution_pairs_every_us_session_with_the_same_day_rate():
    us_days = pd.bdate_range("2026-10-19", "2026-10-30")  # 미국 10거래일, 금요일 2번 포함
    price = pd.DataFrame({"Close": [100.0 + i for i in range(len(us_days))]}, index=us_days)
    fx = deps._fx_bars(_chart(AUTUMN))
    with patch.object(market, "load", return_value=price), \
            patch.object(market, "load_fx_hist", return_value=fx):
        out = market.api_fx_attribution("AAPL", "US", "1m")

    assert out["available"] is True
    assert out["days"] == len(us_days)  # 예전 날짜로는 금요일이 빠져 9일이었다
    assert out["fxStart"] == 1333.43  # 10-19(월)의 실제 환율
    assert out["fxEnd"] == 1335.10
