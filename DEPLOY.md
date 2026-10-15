# 배포 안내 (React 버전)

## Ubuntu 홈서버 · Coolify

기존 Docker 앱 전체를 별도 Coolify 프로젝트로 배포한다. 기존 PostgreSQL·Redis와
볼륨을 공유하지 않는다. 이 구성에는 Render 실행 시간 제한이 없으며, 홈서버의
전원·인터넷과 공개 터널이 연결되어 있어야 한다.

- Git 저장소의 홈서버 배포 브랜치에서 Docker Compose 빌드를 선택한다.
- Base Directory는 `/`, Compose 파일은 `/compose.home.yaml`이다.
- 앱은 컨테이너의 8000번 포트에서 실행하고 호스트의 `127.0.0.1:8010`에 연결한다.
  Coolify 관리 화면의 8000번, 기존 프록시의 80·443번은 유지한다.
- `PUBLIC_SITE_URL`에 실제 HTTPS 공개 origin(포트 포함, 경로 제외)을 지정한다.
  서버가 canonical·OG·robots·sitemap·알림 링크에 반영하며, `APP_BASE_URL`도 같은 값으로 전달한다.
- 필요하면 `GEMINI_API_KEY`를 Coolify 런타임 환경변수에 입력한다. 공개 AI 생성 예산은
  기본 하루 20회다. `ADMIN_KEY`·알림 인증 키·봇 토큰은 Coolify의 비밀 환경변수로 관리한다.
- 전용 `notification-data` 볼륨이 `/var/data`에 마운트된다. SQLite 경로는
  `/var/data/notifications.sqlite3`다. 볼륨 이름은 배포 프로젝트별로 분리한다.
- 자동 알림과 내부 스케줄러는 기본 비활성이다. 기존 발송 작업과 중복되지 않도록
  수신 방·웹훅·영속 저장소를 확인한 뒤 명시적으로 활성화한다.
- 런타임은 CPU 2개·메모리 1GiB로 제한하고, 헬스 체크와 `unless-stopped` 재시작을 사용한다.

Tailscale Funnel을 사용할 경우 해당 서버에서 `--bg --https=8443`과
`http://127.0.0.1:8010`을 연결한다. Funnel 최초 활성화에는 계정 승인이 필요할 수 있다.
관리 UI와 DB 포트는 공개 터널의 대상에 포함하지 않는다.

배포 후 홈·캘린더·시세·차트와 JS/CSS를 실제 공개 주소에서 확인하고,
canonical·OG·robots·sitemap이 새 origin을 가리키는지 검증한다. API·관리 화면은
검색 제외를 유지한다. Google Search Console·네이버 Search Advisor의 소유권 확인과
사이트맵 제출은 사용자 계정에서 진행하며, 검색 준비와 실제 색인은 구분한다.

보유종목·추가 관심종목·매매일지는 사용하던 브라우저의 기존 origin에 저장되어 있다.
주소 변경 전에 백업을 확보하고 새 주소에서 복원한다. 배포 작업은 기존 브라우저
저장소를 삭제하거나 자동으로 옮기지 않는다.

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

## 기존 Render 배포
1. [render.com](https://render.com) 가입 (GitHub 로그인)
2. **New → Blueprint** → 저장소 `hakm12-ship-it/stock-dashboard` 선택
3. `render.yaml` 자동 인식 → **Apply** → Docker 빌드(몇 분) 후 `https://stock-insight-xxxx.onrender.com` 링크 생성
4. 그 링크를 친구들에게 공유

> 무료 플랜은 미사용 시 잠들었다가 첫 접속에 ~30초 깨어남 (Streamlit과 동일).

## 기타 호스트
Dockerfile 하나로 Railway·Fly.io 등에도 동일하게 배포 가능.
