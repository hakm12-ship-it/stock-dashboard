"""간단한 TTL 메모이즈 — 반복 데이터 조회를 흡수해 응답 속도·API 호출 절감."""

import functools
import threading
import time
from services.usage import record_cache


# 이만큼 쌓이면 만료분을 청소한다. 매번 훑으면 낭비고, 안 훑으면 조회한
# 종목 수만큼 DataFrame이 영구히 남아 512MB짜리 무료 인스턴스를 압박한다.
_SWEEP_AT = 64


def _sweep(store: dict, now: float, seconds: float) -> None:
    """만료된 항목 제거.

    키 목록은 list(store.keys())로 한 번에 뜬다 — 파이썬 루프로 items()를 돌면
    그 사이 다른 스레드가 캐시를 채웠을 때 "dict changed size" 로 터진다.
    잠금은 지우지 않는다: 다른 스레드가 그 잠금을 쥔 채로 있을 수 있고,
    지워봐야 아끼는 메모리도 미미하다.
    """
    for k in list(store.keys()):
        hit = store.get(k)
        if hit is not None and now - hit[0] >= seconds:
            store.pop(k, None)


def ttl_cache(seconds: float):
    """인자별로 결과를 seconds 동안 재사용한다.

    같은 키를 동시에 요청하면 한 번만 계산하고 나머지는 그 결과를 기다린다.
    잠금이 없으면 느린 조회(미국 종목목록 13초)에 여러 요청이 겹칠 때
    똑같은 작업을 여러 번 돌린다 — 실제로 기동 시 워밍업과 첫 검색이 겹쳐
    6,700종목을 두 번 훑고 있었다.

    주의: 인자를 키로 쓰므로 실수는 반드시 반올림해서 넘길 것. 원본 실수를
    넘기면 값이 조금만 달라져도 캐시가 안 맞는다.
    """

    def deco(fn):
        store: dict = {}
        # 키마다 잠금을 따로 둔다 — 서로 다른 종목 조회까지 줄 세우면 안 된다.
        locks: dict = {}
        locks_guard = threading.Lock()

        def _lock_for(key):
            with locks_guard:
                return locks.setdefault(key, threading.Lock())

        @functools.wraps(fn)
        def wrap(*args):
            hit = store.get(args)
            if hit is not None and time.time() - hit[0] < seconds:
                record_cache("hit")
                return hit[1]

            with _lock_for(args):
                # 기다리는 동안 다른 스레드가 채웠을 수 있다.
                hit = store.get(args)
                if hit is not None and time.time() - hit[0] < seconds:
                    record_cache("hit")
                    return hit[1]
                record_cache("load")
                try:
                    val = fn(*args)
                except Exception:
                    record_cache("error")
                    raise
                now = time.time()
                store[args] = (now, val)
                if len(store) > _SWEEP_AT:
                    _sweep(store, now, seconds)
                return val

        return wrap

    return deco


# 값의 attrs(pandas DataFrame.attrs)에 이 키로 빠진 부분을 적어 두면
# stale_while_revalidate가 "덜 받은 값"으로 다룬다. 예: ETF 목록만 실패한 종목표.
PARTIAL = "partial"


def _partial(val):
    attrs = getattr(val, "attrs", None)
    return attrs.get(PARTIAL) if isinstance(attrs, dict) else None


def stale_while_revalidate(seconds: float, retry_after: float = 60 * 10):
    """ttl_cache와 같되, 만료된 값을 버리지 않고 바로 돌려준 뒤 뒤에서 새로 받는다.

    미국 종목목록은 받는 데 수십 초가 걸린다. ttl_cache로는 하루 한 번 만료될
    때마다 그 뒤 처음 검색한 사람이 다운로드를 통째로 기다렸다(실측 34초).
    값이 아예 없을 때(콜드 스타트)만 호출자가 기다리고, 그때도 같은 키는 한 번만
    받는다. 백그라운드 갱신도 키마다 하나만 돈다.

    갱신이 실패하면 이전 값을 계속 쓰고 retry_after 뒤에 다시 시도한다(연달아
    실패하면 간격이 두 배씩 늘어 seconds까지).
    덜 받은 값(attrs[PARTIAL])은 콜드 스타트라면 그대로 쓰되 retry_after 뒤 다시
    받고, 갱신에서는 실패로 본다 — 온전한 이전 값을 하루 동안 덮어쓰지 않는다.
    키가 몇 개뿐인 큰 표용이라 만료분 청소는 하지 않는다.
    """

    def deco(fn):
        store: dict = {}
        locks: dict = {}
        refreshing: set = set()
        misses: dict = {}  # 키별로 연달아 온전히 받지 못한 횟수
        guard = threading.Lock()

        def _lock_for(key):
            with guard:
                return locks.setdefault(key, threading.Lock())

        def _load(key):
            record_cache("load")
            try:
                return fn(*key)
            except Exception:
                record_cache("error")
                raise

        def _put(key, val, complete=True):
            # 온전하지 않은 값은 retry_after 뒤에 만료되도록 시각을 당겨 둔다.
            # 연달아 온전히 받지 못하면 간격을 두 배씩 늘려 seconds까지 늦춘다 —
            # 제공처 한쪽이 계속 고장 나도 10분마다 목록 전체를 다시 받지 않는다.
            now = time.time()
            if complete:
                misses.pop(key, None)
                store[key] = (now, val)
                return
            misses[key] = misses.get(key, 0) + 1
            wait = min(seconds, retry_after * 2 ** min(misses[key] - 1, 20))
            store[key] = (now - seconds + wait, val)

        def _refresh(key):
            old = store[key][1]
            try:
                val = _load(key)
                missing = _partial(val)
                if missing and not _partial(old):
                    raise ValueError(f"덜 받은 값({missing})")
                _put(key, val, complete=not missing)
            except Exception as exc:  # noqa: BLE001 - 갱신 실패는 이전 값으로 버틴다
                _put(key, old, complete=False)
                print(f"[cache] {fn.__name__}{key} 갱신 실패, 이전 값을 계속 씁니다: {exc!r}")
            finally:
                with guard:
                    refreshing.discard(key)

        @functools.wraps(fn)
        def wrap(*args):
            hit = store.get(args)
            if hit is None:
                with _lock_for(args):
                    # 기다리는 동안 다른 스레드가 채웠을 수 있다.
                    hit = store.get(args)
                    if hit is None:
                        # 처음엔 덜 받은 값이라도 쓴다 (예: ETF가 빠져도 주식은 검색된다).
                        val = _load(args)
                        _put(args, val, complete=not _partial(val))
                        return val
            elif time.time() - hit[0] >= seconds:
                with guard:
                    start = args not in refreshing
                    refreshing.add(args)
                if start:
                    threading.Thread(target=_refresh, args=(args,), daemon=True,
                                     name=f"refresh-{fn.__name__}").start()
            record_cache("hit")
            return hit[1]

        return wrap

    return deco
