# 스톡 인사이트 (Stock Insight)

한국·미국 종목을 한 화면에서 **기술적 · 기본적 · 신호 · 뉴스 · 포트폴리오** 관점으로 보는 **모바일 우선 웹앱**. 폰 홈화면에 설치(PWA)해서 앱처럼 쓸 수 있습니다.

> ⚠️ 이 도구는 투자 조언이 아닙니다. 모든 정보·신호·추정치는 참고용이며 최종 판단과 책임은 사용자에게 있습니다.

## 주요 기능

- **홈** — 내 자산(원화 통합 손익 + 자산 추이 차트), 지수 스트립(코스피·코스닥·나스닥, 국내는 실시간) + 장 상태, 관심종목 카드(로고·스파크라인 1M/3M/6M·신호·보유 배지·정렬·순서 편집), 종목 검색·추가, 종목 비교, **오늘의 시장 TOP**(급등/급락 + 담기)
- **종합 신호** — 규칙 기반 매수/중립/매도 판정, **신호 규칙 커스터마이즈**(지표 가중치·RSI 기준), **1년 백테스트**(신호 후 평균 수익·적중률), 예상 변동 범위, 지지·저항, 밸류에이션 태그
- **차트** — 캔들(일봉/주봉) + 이동평균 + 볼린저 + 거래량 + RSI + MACD + **지지/저항선**, 십자선 OHLC, 52주 위치 바, **액면분할 자동 보정**
- **가치** — PER·PBR·EPS·ROE·배당·시총, **미래 PER**, **목표주가·투자의견**, **외국인·기관 매매동향**, 연간 실적 막대그래프, 증권사 리포트, ETF 상품개요
- **뉴스** — 종목별 + **관심종목 통합 피드**(최신순·NEW 배지·중복 제거)
- **포트폴리오** — 통화별·원화 통합 손익(환율 반영), 자산 추이, **백업/복원**
- 다크/화이트 테마, 초보자 툴팁, 공유하기, 당겨서 새로고침, 장중 자동 갱신, 설치형 PWA, 첫 방문 온보딩

관심종목·보유종목·테마·신호규칙은 **기기별 localStorage**에 저장 (계정·서버 저장 없음). GitHub Actions가 KST 07~01시에 Render를 깨워둬 첫 접속 지연이 없다.

## 아키텍처

```
[React 프론트엔드]  Vite · TypeScript · Tailwind · lightweight-charts · TanStack Query
        │  /api/* (프록시 또는 동일 오리진)
        ▼
[FastAPI 백엔드]   analysis/·data/ 모듈 재사용, /api JSON + 빌드된 프론트 정적 서빙
        │
FinanceDataReader · yfinance · 네이버(지수·재무·목표주가) · Google News RSS
```

## 저장소 구조

```
├─ frontend/           # React 앱 (Vite)
│  └─ src/{components,views,lib,data}
├─ backend/            # FastAPI (분석 로직 재사용)
│  ├─ main.py          # /api 엔드포인트 + 정적 서빙
│  ├─ analysis/        # technical · fundamental · signal · forecast
│  └─ data/            # symbols · news · naver_index · naver_stock
├─ Dockerfile          # 단일 이미지(프론트 빌드 + 백엔드)
├─ render.yaml         # Render 배포 청사진
├─ stock-dashboard/    # (구) Streamlit 버전 — 병행 유지
└─ react-migration-plan.md · design-system.md
```

## 데이터 소스

- **가격·종목목록·환율·지수 차트**: FinanceDataReader
- **국내 재무·목표주가·실시간 지수**: 네이버 (클라우드에서도 안정적 — yfinance는 클라우드 IP 차단됨)
- **해외 재무**: yfinance
- **뉴스**: Google News RSS

## 로컬 실행

```powershell
# 1) 백엔드 (8000) — 앱 + /api 동시 서빙
cd backend
..\stock-dashboard\.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000

# 2) 프론트 개발 서버 (5173, HMR) — /api 는 8000으로 프록시
cd frontend
npm install
npm run dev
```

- 개발: `http://localhost:5173` (또는 같은 Wi-Fi에서 `http://<PC-IP>:5173`)
- 프로덕션 미리보기: `cd frontend; npm run build` 후 백엔드 `http://localhost:8000`

## 배포 (Render, 무료)

`render.yaml` 청사진으로 Docker 단일 서비스 배포. 자세한 절차는 [DEPLOY.md](DEPLOY.md).

## 기술 스택

React · TypeScript · Vite · Tailwind CSS · lightweight-charts · TanStack Query · FastAPI · Python
