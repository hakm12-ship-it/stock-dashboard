"""스톡 인사이트 API — FastAPI.

기존 분석 모듈(analysis/·data/)을 그대로 재사용해 JSON API로 노출한다.
React 프런트엔드가 이 API를 호출한다.

라우트는 도메인별로 routers/ 아래에 나뉘어 있고, 공용 데이터 로더·헬퍼는
deps.py에 모여 있다.

실행:  uvicorn main:app --reload --port 8000
"""

import threading
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

# 라우터가 임포트되기 전에 .env를 읽어야 API 키가 잡힌다.
load_dotenv(Path(__file__).resolve().parent / ".env")

from deps import cached_symbols  # noqa: E402
from routers import ai, alerts, calendar, fundamental, market, night, prices, signal, telegram  # noqa: E402
from services.scheduler import start_scheduler, stop_scheduler  # noqa: E402

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """선택적 검색 예열과 명시적으로 활성화한 내부 알림 작업을 관리한다.

    무료 서버는 재기동이 잦으므로 전체 종목 검색 예열은 기본 비활성이다.
    PREWARM_SYMBOLS=true인 상시 실행 환경에서만 미리 수집할 수 있다.
    """

    def warm() -> None:
        for market_name_ko in ("한국", "미국"):
            try:
                cached_symbols(market_name_ko)
            except Exception as e:  # noqa: BLE001
                print(f"[warmup] {market_name_ko} 종목목록 실패: {e}")

    # Avoid downloading entire symbol catalogues on every free-service wake.
    if os.environ.get("PREWARM_SYMBOLS", "false").lower() == "true":
        threading.Thread(target=warm, daemon=True).start()
    start_scheduler()
    try:
        yield
    finally:
        stop_scheduler()


app = FastAPI(title="스톡 인사이트 API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.environ.get(
        "CORS_ORIGINS", "http://localhost:5173,http://localhost:5186,http://127.0.0.1:5173"
    ).split(",") if origin.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def private_api_headers(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/") or request.url.path in ("/docs", "/redoc", "/openapi.json"):
        response.headers["X-Robots-Tag"] = "noindex, nofollow"
    if request.url.path.startswith("/api/kakao-"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
    return response

for _router in (prices, fundamental, signal, market, night, ai, alerts, telegram, calendar):
    app.include_router(_router.router)


# ---- 프로덕션: 빌드된 프론트엔드 정적 서빙 (단일 서비스 배포용) ----
# 반드시 모든 /api 라우트 뒤에 마운트해야 API가 우선한다.
_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _DIST.is_dir():
    @app.get("/calendar", response_class=HTMLResponse, include_in_schema=False)
    def calendar_page():
        html = (_DIST / "index.html").read_text(encoding="utf-8")
        html = html.replace("스톡 인사이트 · 한국·미국 주식 리서치", "경제 캘린더 · 금리·경제지표·빅테크 실적 | 스톡 인사이트")
        html = html.replace('href="https://stock-insight-zws6.onrender.com/"', 'href="https://stock-insight-zws6.onrender.com/calendar"')
        html = html.replace('content="https://stock-insight-zws6.onrender.com/"', 'content="https://stock-insight-zws6.onrender.com/calendar"')
        html = html.replace("한국·미국 관심종목의 시세, 차트, 기업 가치와 뉴스를 한곳에서 살펴보세요. 보유종목 손익과 매매 기록을 관리하는 개인 리서치 도구, 스톡 인사이트.", "미국 FOMC·한국은행 금리 결정, CPI·고용·GDP·PCE와 주요 빅테크 실적 발표 일정을 출처와 함께 확인하세요. 확정·예상 일정과 한국시간을 구분합니다.")
        html = html.replace("관심종목 시세부터 차트·기업 가치·뉴스·매매 기록까지, 나만의 투자 리서치 공간.", "금리 결정·주요 경제지표·빅테크 실적 발표를 확인하는 경제 캘린더.")
        return HTMLResponse(html)

    app.mount("/", StaticFiles(directory=str(_DIST), html=True), name="frontend")
