"""API 스모크 테스트 — 모든 엔드포인트가 살아있는지 한 번에 확인한다.

리팩터링·배포 전에 돌려서 깨진 곳을 잡는 용도. 시세는 매번 바뀌므로 값이
아니라 '응답 구조'(키·타입)를 비교한다.

사용법:
    # 1) 백엔드를 먼저 띄운다
    uvicorn main:app --port 8000

    # 2) 현재 상태를 기준선으로 저장
    python smoke_test.py --save baseline.json

    # 3) 코드를 고친 뒤, 기준선과 구조가 같은지 비교
    python smoke_test.py --check baseline.json

    # 그냥 살아있는지만 확인 (기준선 없이)
    python smoke_test.py
"""

import argparse
import json
import sys
import urllib.parse
import urllib.request

BASE = "http://localhost:8000"

# (경로, 파라미터) — 각 엔드포인트를 대표 파라미터로 한 번씩 호출한다.
CALLS = [
    ("/api/health", {}),
    ("/api/symbols", {"market": "KR", "q": "삼성"}),
    ("/api/prices", {"ticker": "005930", "period": "3m"}),
    ("/api/indicators", {"ticker": "005930", "period": "3m"}),
    ("/api/valuation", {"market": "KR", "ticker": "005930"}),
    ("/api/trend", {"market": "KR", "ticker": "005930"}),
    ("/api/signal", {"ticker": "005930"}),
    ("/api/signal-history", {"ticker": "005930"}),
    ("/api/forecast", {"ticker": "005930"}),
    ("/api/news", {"market": "KR", "name": "삼성전자"}),
    ("/api/forward-pe", {"market": "KR", "ticker": "005930"}),
    ("/api/target", {"market": "KR", "ticker": "005930"}),
    ("/api/market-top", {"direction": "up", "market": "KOSPI"}),
    ("/api/groups", {"kind": "industry"}),
    ("/api/group-stocks", {"no": 261, "kind": "industry"}),
    ("/api/peers", {"market": "KR", "ticker": "005930"}),
    ("/api/deal-trend", {"market": "KR", "ticker": "005930"}),
    ("/api/profile", {"market": "KR", "ticker": "005930"}),
    ("/api/index", {"name": "KOSPI"}),
    ("/api/fx", {}),
    ("/api/fx-history", {"period": "3m"}),
    ("/api/macro", {}),
    ("/api/daily-report", {}),
    ("/api/night-price", {"ticker": "005930"}),
    ("/api/night-candles", {"ticker": "005930", "interval": "5m"}),
    ("/api/night-gap-history", {"ticker": "005930"}),
    ("/api/related-insight", {"ticker": "000660"}),
    ("/api/ai-briefing", {"market": "KR", "ticker": "005930", "name": "삼성전자"}),
    # 레버리지·합성추정 — 국내(0193T0)와 미국(KORU) 경로가 갈리므로 둘 다 본다
    ("/api/leverage-decay", {"ticker": "KORU", "period": "6m"}),
    ("/api/fx-attribution", {"ticker": "SOXL", "market": "US", "period": "3m"}),
    ("/api/synth-price", {"ticker": "KORU"}),
    ("/api/synth-price", {"ticker": "0193T0"}),
    # 알림 계열 — 실제 발송(/api/market-alert-check, /api/kakao-test)은 넣지 않는다.
    # 스모크 테스트를 돌릴 때마다 텔레그램 그룹에 메시지가 가면 안 된다.
    ("/api/market-alert-config", {}),
    ("/api/alert-invite", {}),
    ("/api/kakao-redirect-uri", {}),
    ("/api/kakao-token-status", {}),
    # 관리자 키 없이 부르면 차단 화면이 떠야 한다 (열려 있으면 여기서 드러난다).
    ("/api/kakao-auth", {}),
]


def shape(v):
    """값 대신 구조만 남긴다 (리스트는 비었는지 여부와 첫 원소 구조)."""
    if isinstance(v, dict):
        return {k: shape(x) for k, x in sorted(v.items())}
    if isinstance(v, list):
        return ["<empty>"] if not v else [shape(v[0]), "len>0"]
    if v is None:
        return "null"
    return type(v).__name__


def collect() -> dict:
    result = {}
    for path, params in CALLS:
        query = urllib.parse.urlencode(params) if params else ""
        url = f"{BASE}{path}" + (f"?{query}" if query else "")
        # 같은 경로를 파라미터만 바꿔 여러 번 부르므로(예: synth-price의 국내/미국),
        # 경로만 키로 쓰면 뒤엣것이 앞엣것을 덮어써 결과가 조용히 사라진다.
        key = f"{path}?{query}" if query else path
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                body = r.read()
                # 카카오 인증 화면만 HTML이다. 본문은 매번 같지 않을 수 있으니
                # 구조 비교에는 타입만 남긴다.
                if "json" in r.headers.get("Content-Type", ""):
                    result[key] = {"status": r.status, "shape": shape(json.loads(body))}
                else:
                    result[key] = {"status": r.status, "shape": "<html>"}
        except Exception as e:
            result[key] = {"status": "ERROR", "shape": str(e)}
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--save", metavar="FILE", help="현재 응답 구조를 기준선으로 저장")
    ap.add_argument("--check", metavar="FILE", help="기준선과 구조가 같은지 비교")
    args = ap.parse_args()

    print(f"{len(CALLS)}개 엔드포인트 확인 중... ({BASE})")
    result = collect()

    failed = [p for p, v in result.items() if v["status"] != 200]
    for p in failed:
        print(f"  ✗ {p} — {result[p]['shape']}")
    print(f"응답 실패: {len(failed)}개" if failed else "모든 엔드포인트 200 OK")

    if args.save:
        with open(args.save, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2, sort_keys=True)
        print(f"기준선 저장 -> {args.save}")

    drifted = []
    if args.check:
        try:
            with open(args.check, encoding="utf-8") as f:
                base = json.load(f)
        except FileNotFoundError:
            print(f"\n기준선 파일이 없어요: {args.check}")
            print(f"먼저 만들어 두세요:  python smoke_test.py --save {args.check}")
            sys.exit(1)
        for k in sorted(set(base) | set(result)):
            if base.get(k) != result.get(k):
                drifted.append(k)
        if drifted:
            print(f"\n구조가 달라진 엔드포인트 {len(drifted)}개:")
            for k in drifted:
                print(f"  ! {k}")
                print(f"    기준선: {json.dumps(base.get(k), ensure_ascii=False)[:200]}")
                print(f"    현재  : {json.dumps(result.get(k), ensure_ascii=False)[:200]}")
        else:
            print("기준선과 응답 구조 동일")

    sys.exit(1 if (failed or drifted) else 0)


if __name__ == "__main__":
    main()
