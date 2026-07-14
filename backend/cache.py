"""간단한 TTL 메모이즈 — 반복 데이터 조회를 흡수해 응답 속도·API 호출 절감."""

import functools
import time


def ttl_cache(seconds: float):
    def deco(fn):
        store: dict = {}

        @functools.wraps(fn)
        def wrap(*args):
            now = time.time()
            hit = store.get(args)
            if hit is not None and now - hit[0] < seconds:
                return hit[1]
            val = fn(*args)
            store[args] = (now, val)
            return val

        return wrap

    return deco
