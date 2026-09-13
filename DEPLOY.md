# 배포 안내 (React 버전)

## 2026-09 변경 사항 — 배포 전 운영 설정

이번 리뉴얼에서는 배포·운영 환경변수·외부 스케줄러를 변경하지 않았다.

- `/api/market-alert-check`, `/api/night-alert-check`는 이제 `Authorization: Bearer <키>`가 필요하다. `ALERT_CHECK_KEY`를 서버와 스케줄러에 동일하게 설정한다. 별도 키가 없으면 기존 `ADMIN_KEY`를 사용한다. 두 키 모두 없으면 503으로 차단하며, 잘못된 인증은 401이다. 기존 URL과 쿼리 인자는 유지되지만 인증 없는 기존 스케줄러는 배포 후 동작하지 않으므로 반드시 먼저 설정한다. 키를 프론트 코드나 공개 URL에 넣지 않는다.
- `/api/kakao-redirect-uri`, `/api/kakao-token-status` 진단 API는 `ADMIN_KEY` Bearer 인증이 필요하다. 카카오 관리자 화면·콜백은 `no-store`, `no-referrer` 헤더와 검색 제외를 적용한다.
- CORS 기본 허용은 로컬 개발 주소다. 다른 프론트 도메인이 API를 직접 호출할 경우 `CORS_ORIGINS`에 정확한 origin을 쉼표로 구분해 넣는다. Docker/Render 동일 origin 구성에는 별도 허용이 필요 없다.
- SEO는 기존 공개 주소 `https://stock-insight-zws6.onrender.com/`를 기준으로 준비했다. 다른 도메인으로 배포하면 `frontend/index.html`, `frontend/public/robots.txt`, `frontend/public/sitemap.xml`의 주소를 함께 바꾼다.
- 배포 후 공개 URL에서 HTML 제목·description·canonical·OG, robots.txt, sitemap.xml의 200 응답, 실제 JS/CSS 로드, API/관리자 응답의 X-Robots-Tag를 확인한다. Search Console/네이버 서치어드바이저의 소유권 확인과 사이트맵 제출은 사용자 계정에서 해야 한다. 검색 준비와 실제 색인 완료는 다르다. 이번 작업은 로컬 검증까지 수행했다.

새 백업은 v2로 보유종목·추가 관심종목·매매일지를 포함한다. v1도 복원할 수 있으며, 백업에 없는 목록은 유지된다. 데이터베이스 변경은 없다. 이전 버전으로 되돌릴 때에도 localStorage 키를 유지한다. 롤백 전에 백업 파일을 내려받는 것이 좋다.

React 버전은 **프론트 빌드 + FastAPI 서빙**을 한 Docker 이미지로 묶어 배포한다.
(현 Streamlit 버전은 Streamlit Cloud에 그대로 유지 — 병행)

## 로컬 미리보기
```powershell
# 1) 프론트 빌드
cd C:\PJT\frontend ; npm run build
# 2) 백엔드 실행 (빌드된 앱까지 서빙)
cd C:\PJT\backend ; ..\stock-dashboard\.venv\Scripts\python.exe -m uvicorn main:app --port 8000
# → http://localhost:8000  (앱 + /api 동시)
```

개발 중엔 두 개를 따로: 백엔드 `:8000` + `cd frontend; npm run dev`(`:5173`, /api 프록시).

## Render 배포 (무료, 추천)
1. [render.com](https://render.com) 가입 (GitHub 로그인)
2. **New → Blueprint** → 저장소 `hakm12-ship-it/stock-dashboard` 선택
3. `render.yaml` 자동 인식 → **Apply** → Docker 빌드(몇 분) 후 `https://stock-insight-xxxx.onrender.com` 링크 생성
4. 그 링크를 친구들에게 공유

> 무료 플랜은 미사용 시 잠들었다가 첫 접속에 ~30초 깨어남 (Streamlit과 동일).

## 기타 호스트
Dockerfile 하나로 Railway·Fly.io 등에도 동일하게 배포 가능.
