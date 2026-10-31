"""/api/forecast, /api/signal-history horizon 범위 제한 — 네트워크 없이 검증."""
from datetime import datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import signal


def fresh_candles(periods=90):
    end = datetime.now(ZoneInfo("America/New_York")).date() - timedelta(days=1)
    idx = pd.bdate_range(end=end, periods=periods)
    close = [100 + (i % 7) for i in range(periods)]
    return pd.DataFrame({"Open": close, "High": close, "Low": close,
                         "Close": close, "Volume": 100}, index=idx)


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(signal.router)
    return TestClient(app)


@pytest.mark.parametrize("horizon", [0, -1, 31, 100000])
def test_forecast_horizon_out_of_range_rejected_before_loading(client, horizon):
    with patch.object(signal, "load") as loader:
        response = client.get("/api/forecast", params={"ticker": "NVDA", "horizon": horizon})
    assert response.status_code == 422
    loader.assert_not_called()


@pytest.mark.parametrize("horizon", [0, -5, 61])
def test_signal_history_horizon_out_of_range_rejected_before_loading(client, horizon):
    with patch.object(signal, "load") as loader:
        response = client.get("/api/signal-history", params={"ticker": "NVDA", "horizon": horizon})
    assert response.status_code == 422
    loader.assert_not_called()


def test_default_and_boundary_horizons_still_served(client):
    with patch.object(signal, "load", return_value=fresh_candles()):
        default = client.get("/api/forecast", params={"ticker": "NVDA"})
        widest = client.get("/api/forecast", params={"ticker": "NVDA", "horizon": 30})
        hist = client.get("/api/signal-history", params={"ticker": "NVDA"})
        hist_max = client.get("/api/signal-history", params={"ticker": "NVDA", "horizon": 60})
        direct = signal.api_forecast("NVDA")
        direct_hist = signal.api_signal_history("NVDA")
    assert default.status_code == 200 and default.json()["available"] is True
    assert len(default.json()["band"]) == 7
    assert len(widest.json()["band"]) == 30
    assert hist.status_code == 200 and hist.json()["horizon"] == 5
    assert hist_max.status_code == 200 and hist_max.json()["horizon"] == 60
    # 함수 직접 호출 시에도 int 기본값이 유지돼야 한다(Query 객체가 새어 들어가면 안 됨).
    assert len(direct["band"]) == 7
    assert direct_hist["horizon"] == 5
