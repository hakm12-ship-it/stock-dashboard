"""ttl_cache — 적중·만료·청소·동시성.

캐시가 조용히 안 먹으면 외부 API 호출이 몇 배로 늘고, 만료분을 안 지우면
조회한 종목 수만큼 DataFrame이 쌓여 무료 인스턴스 메모리를 갉아먹는다.
둘 다 눈에 안 띄게 나빠지는 종류라 검사로 잡아둔다.
"""

import threading
import time
import unittest

from cache import _SWEEP_AT, ttl_cache


def _store_of(fn):
    """클로저 안의 캐시 저장소를 꺼낸다."""
    dicts = [c.cell_contents for c in fn.__closure__ if isinstance(c.cell_contents, dict)]
    return max(dicts, key=len) if dicts else {}


class TTL캐시(unittest.TestCase):
    def test_같은_인자는_한_번만_계산한다(self):
        calls = []

        @ttl_cache(5)
        def f(x):
            calls.append(x)
            return x * 2

        self.assertEqual([f(1), f(1), f(1)], [2, 2, 2])
        self.assertEqual(calls, [1])

    def test_만료되면_다시_계산한다(self):
        calls = []

        @ttl_cache(0.3)
        def f(x):
            calls.append(x)
            return x

        f(1)
        time.sleep(0.35)
        f(1)
        self.assertEqual(calls, [1, 1])

    def test_만료분을_청소한다(self):
        @ttl_cache(0.3)
        def f(x):
            return x

        for i in range(_SWEEP_AT + 5):
            f(i)
        time.sleep(0.35)
        f(99)  # 이 호출에서 청소가 돈다
        self.assertLessEqual(len(_store_of(f)), 2)

    def test_같은_키를_동시에_불러도_한_번만_계산한다(self):
        """잠금이 없으면 느린 조회에 요청이 겹칠 때 같은 일을 여러 번 한다."""
        calls = []

        @ttl_cache(5)
        def slow(x):
            calls.append(x)
            time.sleep(0.2)
            return x

        ts = [threading.Thread(target=slow, args=(7,)) for _ in range(5)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        self.assertEqual(calls, [7])

    def test_다른_키는_서로_기다리지_않는다(self):
        @ttl_cache(5)
        def slow(x):
            time.sleep(0.2)
            return x

        start = time.time()
        ts = [threading.Thread(target=slow, args=(i,)) for i in range(5)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        # 줄 세우면 1.0초, 겹쳐 돌면 0.2초대
        self.assertLess(time.time() - start, 0.6)


if __name__ == "__main__":
    unittest.main()
