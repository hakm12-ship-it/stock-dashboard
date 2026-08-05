"""간단한 TTL 메모이즈 — 반복 데이터 조회를 흡수해 응답 속도·API 호출 절감."""

import functools
import threading
import time


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
                return hit[1]

            with _lock_for(args):
                # 기다리는 동안 다른 스레드가 채웠을 수 있다.
                hit = store.get(args)
                if hit is not None and time.time() - hit[0] < seconds:
                    return hit[1]
                val = fn(*args)
                now = time.time()
                store[args] = (now, val)
                if len(store) > _SWEEP_AT:
                    _sweep(store, now, seconds)
                return val

        return wrap

    return deco
