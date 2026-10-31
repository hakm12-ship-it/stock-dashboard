"""외부 HTTP 기본 시간 제한 — FDR이 timeout 없이 부르는 요청이 영원히 멈추지 않게.

FDR은 야후·네이버를 requests로, KS11/KQ11 이력을 pd.read_csv(url)로 받으면서
timeout을 주지 않는다. 연결만 받고 응답하지 않는 업스트림이면 요청 스레드와
캐시 키 잠금이 끝없이 묶여, 그런 스레드가 쌓이면 /api/health까지 멈췄다.
네트워크는 쓰지 않는다 — 연결만 받고 한 바이트도 보내지 않는 로컬 소켓을 띄운다.
"""

import socket
import threading
import time
import urllib.request
from unittest.mock import patch

import pandas as pd
import pytest
import requests
from requests.adapters import HTTPAdapter

import deps


@pytest.fixture
def silent_url():
    """연결은 받지만 응답하지 않는 로컬 서버 주소."""
    srv = socket.create_server(("127.0.0.1", 0))
    srv.settimeout(0.1)
    held, stop = [], threading.Event()

    def serve():
        while not stop.is_set():
            try:
                conn, _ = srv.accept()
            except OSError:  # 0.1초마다 stop 확인
                continue
            held.append(conn)

    t = threading.Thread(target=serve, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.getsockname()[1]}"
    stop.set()
    t.join(2)
    for conn in held:
        conn.close()
    srv.close()


@pytest.fixture
def socket_default():
    """테스트 동안 바꾼 소켓 기본 timeout을 원래대로 되돌린다."""
    before = socket.getdefaulttimeout()
    yield
    socket.setdefaulttimeout(before)


def _within(seconds, fn):
    """fn이 seconds 안에 끝나는지 본다. 멈추면 테스트가 걸리지 않고 실패한다."""
    out = {}

    def run():
        start = time.monotonic()
        try:
            fn()
        except BaseException as e:  # noqa: BLE001
            out["error"] = e
        out["elapsed"] = time.monotonic() - start

    t = threading.Thread(target=run, daemon=True)
    t.start()
    t.join(seconds)
    assert not t.is_alive(), f"{seconds}초가 지나도 응답을 기다리고 있다"
    return out.get("error"), out["elapsed"]


def _session():
    # 시스템 프록시를 거치지 않게 해 로컬 서버로만 간다.
    s = requests.Session()
    s.trust_env = False
    return s


def test_installed_once_at_import():
    assert getattr(HTTPAdapter.send, "default_timeout", False)
    assert socket.getdefaulttimeout() is not None
    send = HTTPAdapter.send
    deps._install_default_timeouts()
    deps._install_default_timeouts()
    assert HTTPAdapter.send is send  # 겹쳐 감싸지 않는다
    assert not getattr(send.__wrapped__, "default_timeout", False)


def test_only_missing_timeouts_are_filled():
    seen = []
    wrapped = deps._with_default_timeout(lambda self, req, stream, timeout, *a, **kw: seen.append((stream, timeout, a, kw)))

    wrapped("adapter", "req")
    wrapped("adapter", "req", timeout=None, verify=True)
    wrapped("adapter", "req", stream=True, timeout=(1, 2))
    wrapped("adapter", "req", False, 3, True)  # 위치 인자로 넘겨도 같다

    assert seen == [
        (False, deps._HTTP_TIMEOUT, (), {}),
        (False, deps._HTTP_TIMEOUT, (), {"verify": True}),
        (True, (1, 2), (), {}),
        (False, 3, (True,), {}),
    ]


def test_requests_without_timeout_give_up_on_a_silent_upstream(silent_url):
    # FDR과 같은 호출 — timeout 인자 없이 부른다.
    with patch.object(deps, "_HTTP_TIMEOUT", (1, 0.5)):
        error, elapsed = _within(10, lambda: _session().get(silent_url + "/siseJson"))
    assert isinstance(error, requests.exceptions.ReadTimeout)
    assert elapsed < 5


def test_explicit_timeout_is_not_shortened(silent_url):
    with patch.object(deps, "_HTTP_TIMEOUT", (0.2, 0.2)):
        error, elapsed = _within(10, lambda: _session().get(silent_url, timeout=(1, 1.5)))
    assert isinstance(error, requests.exceptions.ReadTimeout)
    assert elapsed >= 1.4  # 기본값 0.2초가 아니라 호출부가 준 1.5초를 기다렸다


def test_read_csv_url_gives_up_on_a_silent_upstream(silent_url, socket_default):
    # KS11/KQ11 이력은 FDR이 pd.read_csv(url)로 받는다(urllib, timeout 없음).
    socket.setdefaulttimeout(0.5)
    no_proxy = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with patch.object(urllib.request, "_opener", no_proxy):
        error, elapsed = _within(10, lambda: pd.read_csv(silent_url + "/2026.csv"))
    assert error is not None
    assert elapsed < 5


def test_existing_socket_default_is_kept(socket_default):
    socket.setdefaulttimeout(60)
    deps._install_default_timeouts()
    assert socket.getdefaulttimeout() == 60
