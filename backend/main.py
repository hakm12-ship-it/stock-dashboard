"""스톡 인사이트 API — FastAPI.

기존 분석 모듈(analysis/·data/)을 그대로 재사용해 JSON API로 노출한다.
React 프런트엔드가 이 API를 호출한다.

라우트는 도메인별로 routers/ 아래에 나뉘어 있고, 공용 데이터 로더·헬퍼는
deps.py에 모여 있다.

실행:  uvicorn main:app --reload --port 8000
"""

import threading
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# 라우터가 임포트되기 전에 .env를 읽어야 API 키가 잡힌다.
load_dotenv(Path(__file__).resolve().parent / ".env")

from deps import cached_symbols  # noqa: E402
from routers import ai, alerts, fundamental, market, night, prices, signal  # noqa: E402

app = FastAPI(title="스톡 인사이트 API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 개발용. 배포 시 프런트 도메인으로 좁힐 것.
    allow_methods=["*"],
    allow_headers=["*"],
)

for _router in (prices, fundamental, signal, market, night, ai, alerts):
    app.include_router(_router.router)


@app.on_event("startup")
def _warm_symbol_lists() -> None:
    """종목 목록을 백그라운드로 미리 받아둔다.

    미국 목록은 NASDAQ+NYSE 6,700종목을 훑느라 첫 조회에 13초가 걸린다.
    그대로 두면 캐시가 빈 상태에서 검색한 사람이 그 시간을 그대로 기다린다.
    스레드로 돌리므로 서버 기동을 막지 않고, 실패해도 그냥 첫 검색이
    느려질 뿐이라 조용히 넘어간다.
    """

    def warm() -> None:
        for market_name_ko in ("한국", "미국"):
            try:
                cached_symbols(market_name_ko)
            except Exception as e:  # noqa: BLE001
                print(f"[warmup] {market_name_ko} 종목목록 실패: {e}")

    threading.Thread(target=warm, daemon=True).start()


# ---- 프로덕션: 빌드된 프론트엔드 정적 서빙 (단일 서비스 배포용) ----
# 반드시 모든 /api 라우트 뒤에 마운트해야 API가 우선한다.
_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(_DIST), html=True), name="frontend")
