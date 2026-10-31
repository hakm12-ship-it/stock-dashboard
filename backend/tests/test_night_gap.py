"""야간 갭 백테스트의 시각 정렬 — 주말·휴일을 낀 거래일 쌍. 네트워크 없음."""

import random
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

import pandas as pd
import pytest

from analysis.night_gap import closes_by_krx_open, night_gap_backtest
from routers import night

# KRX 휴장일(평일) — 월요일 하루, 목·금 연휴. perp는 이 동안에도 거래된다.
HOLIDAYS = {date(2026, 8, 17), date(2026, 9, 24), date(2026, 9, 25)}
FIRST, LAST = date(2026, 8, 3), date(2026, 10, 2)


def utc_ms(d: date) -> int:
    return int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp() * 1000)


def daily_candles(moves: dict[date, float], start_px: float = 100.0) -> list[dict]:
    """moves[D] = D일 UTC 00:00(KST 09:00)에 시작하는 1d 캔들의 등락률(%)."""
    out, px = [], start_px
    for d in sorted(moves):
        o, px = px, px * (1 + moves[d] / 100)
        out.append({"t": utc_ms(d), "o": o, "h": max(o, px), "l": min(o, px), "c": px, "v": 1.0})
    return out


def sessions() -> list[date]:
    d, out = FIRST, []
    while d <= LAST:
        if d.weekday() < 5 and d not in HOLIDAYS:
            out.append(d)
        d += timedelta(days=1)
    return out


def krx_following(perp_close: pd.Series, days: list[date]) -> pd.DataFrame:
    """시가가 'prev 개장 → cur 개장' perp 변화를 그대로 따르는 KRX 일봉."""
    rows, close = [], 50_000.0
    for i, d in enumerate(days):
        if i:
            close *= perp_close[d] / perp_close[days[i - 1]]
        rows.append({"Open": close, "Close": close})
    return pd.DataFrame(rows, index=days)


def calendar(first: date, last: date) -> list[date]:
    return [first + timedelta(days=i) for i in range((last - first).days + 1)]


def test_candle_is_keyed_by_the_krx_open_it_closes_before():
    fri, sat, sun = date(2026, 9, 4), date(2026, 9, 5), date(2026, 9, 6)
    candles = daily_candles({fri: 1.0, sat: 2.0, sun: -3.0})
    closes = closes_by_krx_open(candles)

    # 금요일 시작 캔들은 토요일 09:00 KST에 닫힌다.
    assert closes[sat] == candles[0]["c"]
    # 월요일 개장 직전 가격 = 일요일 시작 캔들 종가 (토·일 움직임 포함).
    assert closes[date(2026, 9, 7)] == candles[2]["c"]
    assert fri not in closes.index


def test_candle_not_starting_at_utc_midnight_is_dropped():
    # 종가가 KST 09:00 뒤라면 그날 시가를 '미리 아는' 값이 된다.
    candles = [{"t": utc_ms(date(2026, 9, 7)) + 3_600_000, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}]
    assert closes_by_krx_open(candles).empty


def test_weekend_and_holiday_moves_land_on_the_next_session():
    """perp는 휴장일에 시작하는 캔들에서만 +3%씩 오르고, 다음 개장 시가가 그만큼 뛴다.

    예전 정렬(시작일 키 + prev/pprev 비교)에선 월요일 갭이 금→토 0%로 잡히고,
    주말 상승분은 화요일 표본으로 밀려 시가 0%와 짝지어졌다.
    """
    days = sessions()
    moves = {
        d: 3.0 if d.weekday() >= 5 or d in HOLIDAYS else 0.0
        for d in calendar(FIRST - timedelta(days=3), LAST)
    }
    closes = closes_by_krx_open(daily_candles(moves))
    krx = krx_following(closes, days)

    result = night_gap_backtest(closes, krx)

    after_break = [cur for prev, cur in zip(days, days[1:]) if (cur - prev).days > 1]
    assert date(2026, 8, 18) in after_break  # 주말 + 월요일 휴장 뒤 화요일
    assert date(2026, 9, 28) in after_break  # 목·금 연휴 + 주말 뒤 월요일
    by_label = {b["label"]: b for b in result["buckets"]}
    assert by_label["+2% 초과"]["count"] == len(after_break)
    assert by_label["+2% 초과"]["upRatio"] == 100.0
    assert by_label["0 ~ +2%"]["count"] == len(days) - 1 - len(after_break)
    assert by_label["0 ~ +2%"]["avgOpenChange"] == pytest.approx(0.0)
    assert result["samples"] == len(days) - 1


def test_open_change_tracks_perp_move_exactly_across_breaks():
    rng = random.Random(7)
    days = sessions()
    moves = {d: rng.uniform(-3, 3) for d in calendar(FIRST - timedelta(days=3), LAST)}
    closes = closes_by_krx_open(daily_candles(moves))
    krx = krx_following(closes, days)

    result = night_gap_backtest(closes, krx)

    assert result["samples"] == len(days) - 1
    assert result["correlation"] == pytest.approx(1.0)
    assert result["directionMatch"] == 100.0


def test_missing_perp_candle_skips_only_that_pair():
    rng = random.Random(11)
    days = sessions()
    moves = {d: rng.uniform(-3, 3) for d in calendar(FIRST - timedelta(days=3), LAST)}
    candles = daily_candles(moves)
    closes = closes_by_krx_open(candles)
    krx = krx_following(closes, days)
    gone = date(2026, 9, 9)  # 수요일 개장 직전 가격이 빠지면 (화→수), (수→목) 두 쌍만 빠진다.
    closes = closes.drop(gone)

    result = night_gap_backtest(closes, krx)

    assert result["samples"] == len(days) - 3
    assert result["correlation"] == pytest.approx(1.0)


def test_router_feeds_close_keyed_candles_to_backtest():
    rng = random.Random(3)
    days = sessions()
    moves = {d: rng.uniform(-3, 3) for d in calendar(FIRST - timedelta(days=3), LAST)}
    candles = daily_candles(moves)
    krx = krx_following(closes_by_krx_open(candles), days)
    krx.index = pd.to_datetime(krx.index)  # FDR처럼 DatetimeIndex

    with patch.object(night, "cached_perp_candles", return_value=candles) as fetch, \
            patch.object(night, "load", return_value=krx):
        result = night._night_gap.__wrapped__("005930", "xyz:SMSN")

    fetch.assert_called_once_with("xyz:SMSN", "1d", 200)
    assert result["samples"] == len(days) - 1
    assert result["correlation"] == pytest.approx(1.0)
