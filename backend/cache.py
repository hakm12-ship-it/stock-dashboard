"""간단한 TTL 메모이즈 — 반복 데이터 조회를 흡수해 응답 속도·API 호출 절감."""

import functools
import threading
import time


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
                store[args] = (time.time(), val)
                return val

        return wrap

    return deco
