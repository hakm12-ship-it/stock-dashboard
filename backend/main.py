"""스톡 인사이트 API — FastAPI.

기존 분석 모듈(analysis/·data/)을 그대로 재사용해 JSON API로 노출한다.
React 프런트엔드가 이 API를 호출한다.

라우트는 도메인별로 routers/ 아래에 나뉘어 있고, 공용 데이터 로더·헬퍼는
deps.py에 모여 있다.

실행:  uvicorn main:app --reload --port 8000
"""

from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# 라우터가 임포트되기 전에 .env를 읽어야 API 키가 잡힌다.
load_dotenv(Path(__file__).resolve().parent / ".env")

from routers import ai, fundamental, market, night, prices, signal  # noqa: E402

app = FastAPI(title="스톡 인사이트 API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 개발용. 배포 시 프런트 도메인으로 좁힐 것.
    allow_methods=["*"],
    allow_headers=["*"],
)

for _router in (prices, fundamental, signal, market, night, ai):
    app.include_router(_router.router)


# ---- 프로덕션: 빌드된 프론트엔드 정적 서빙 (단일 서비스 배포용) ----
# 반드시 모든 /api 라우트 뒤에 마운트해야 API가 우선한다.
_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(_DIST), html=True), name="frontend")
