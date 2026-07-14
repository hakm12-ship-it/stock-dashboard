# 배포 안내 (React 버전)

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
