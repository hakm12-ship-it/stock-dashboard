from datetime import datetime
from unittest.mock import patch

import pandas as pd
from fastapi import FastAPI
from fastapi.testclient import TestClient

import deps
from data.freshness import history_freshness
from routers import prices, signal, market, ai


def candles(end="2026-10-02", periods=90, value=7003.74):
    idx = pd.bdate_range(end=end, periods=periods)
    return pd.DataFrame({"Open": value, "High": value + 1, "Low": value - 1,
                         "Close": value, "Volume": 100}, index=idx)


def test_index_history_replaces_old_ohlc_and_all_loaders_share_it():
    old = candles("2026-09-17", value=6724.34)
    fresh = candles(periods=30)
    with patch.object(deps.fdr, "DataReader", return_value=old), patch.object(deps, "daily_index", return_value=fresh):
        df = deps._kr_index_history.__wrapped__("KS11")
    assert df.index.is_unique
    assert df.iloc[-1]["Close"] == 7003.74
    assert df.iloc[-1]["High"] == 7004.74
    with patch.object(deps, "_kr_index_history", return_value=df):
        loaded = deps._fetch("KS11", pd.Timestamp("2026-09-01").date())
    assert loaded.iloc[-1]["Close"] == 7003.74
    assert loaded.index.min() >= pd.Timestamp("2026-09-01")


def test_freshness_weekend_and_old_history():
    now = datetime.fromisoformat("2026-10-04T08:00:00+09:00")
    assert not history_freshness(candles(), "KS11", now)["stale"]
    assert history_freshness(candles("2026-09-17"), "KS11", now)["stale"]
    quote = {"asOf": "2026-10-02T15:30:00+09:00", "marketOpen": False}
    assert history_freshness(candles("2026-10-01"), "KS11", now, quote)["stale"]


def test_stale_signal_and_forecast_never_present_actionable_result():
    with patch.object(signal, "load", return_value=candles("2020-09-17")), patch.object(signal, "cached_naver_index", side_effect=RuntimeError):
        result = signal.api_signal("KS11")
        forecast = signal.api_forecast("KS11")
    assert result["available"] is False
    assert result["verdict"] == "분석 보류"
    assert result["signals"] == []
    assert result["asOf"] == "2020-09-17"
    assert forecast["band"] == []


def test_quote_and_history_dates_are_separate():
    df = candles("2026-09-17", value=6724.34)
    quote = {"last": 7003.74, "change": 32.39, "changePct": .46,
             "asOf": "2026-10-02T15:30:00+09:00", "marketOpen": False}
    with patch.object(market, "load_index", return_value=df), patch.object(market, "cached_naver_index", return_value=quote):
        result = market.api_index("KOSPI")
    assert result["last"] == 7003.74
    assert result["quoteAsOf"].startswith("2026-10-02")
    assert result["history"]["asOf"] == "2026-09-17"
    assert result["history"]["stale"] is True


def test_older_quote_cannot_overwrite_newer_history():
    quote = {"last": 6724.34, "change": 1, "changePct": .1, "asOf": "2026-09-17T15:30:00+09:00"}
    with patch.object(market, "load_index", return_value=candles()), patch.object(market, "cached_naver_index", return_value=quote):
        result = market.api_index("KOSPI")
    assert result["last"] == 7003.74
    assert result["quoteAsOf"] == "2026-10-02"


def test_watchlist_limit_before_upstream_work_and_partial_failure():
    app = FastAPI()
    app.include_router(prices.router)
    client = TestClient(app)
    with patch.object(prices, "load") as loader:
        assert client.get("/api/watchlist", params={"tickers": ",".join(f"A{i}" for i in range(21))}).status_code == 422
        assert client.get("/api/watchlist", params={"tickers": "../bad"}).status_code == 422
        loader.assert_not_called()
    df = candles(pd.Timestamp.now().strftime("%Y-%m-%d"))
    def fetch(ticker, period):
        if ticker == "FAIL":
            raise RuntimeError("provider detail must not leak")
        assert period == "6m"
        return df
    with patch.object(prices, "load", side_effect=fetch), patch.object(prices, "api_signal", return_value={"available": True}):
        result = client.get("/api/watchlist", params={"tickers": "NVDA,FAIL,NVDA", "period": "1m"}).json()
    assert len(result) == 2
    assert len(result[0]["candles"]) < len(df)
    assert result[1]["error"] == "시세를 불러오지 못했습니다."


def test_watchlist_reuses_quote_aware_signal_freshness():
    result = {"available": False, "stale": True, "asOf": "2026-10-01", "source": "Naver", "reason": "waiting"}
    with patch.object(prices, "load", return_value=candles()), patch.object(prices, "api_signal", return_value=result):
        row = prices._watchlist_item(("KS11", "1m", {}))
    assert row["stale"] is True
    assert row["asOf"] == row["signal"]["asOf"]


def test_index_briefing_accepts_known_index_but_holdings_do_not():
    import pytest
    with patch.object(ai.public_ai, "cached", return_value={"summary": "cached"}):
        assert ai.api_ai_briefing("KR", "KS11")["available"]
    with pytest.raises(ValueError):
        ai._instrument("KR", "KS11")
