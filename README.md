# 스톡 인사이트 (Stock Insight)

한국·미국 종목을 한 화면에서 **기술적 · 기본적 · 신호 · 뉴스 · 포트폴리오** 관점으로 보는 **모바일 우선 웹앱**. 폰 홈화면에 설치(PWA)해서 앱처럼 쓸 수 있습니다.

> ⚠️ 이 도구는 투자 조언이 아닙니다. 모든 정보·신호·추정치는 참고용이며 최종 판단과 책임은 사용자에게 있습니다.

## 주요 기능

- **홈** — 내 자산(포트폴리오 손익·원화 통합), 지수(KOSPI·NASDAQ) + 장 상태, 관심종목 카드(스파크라인·신호·정렬), 종목 검색·추가, 종목 비교
- **종합 신호** — 규칙 기반 매수/중립/매도 판정, 예상 변동 범위, 지지·저항, 밸류에이션 태그
- **차트** — 캔들 + 이동평균 + 볼린저 + 거래량 + RSI + MACD, 십자선 OHLC, 52주 위치 바
- **가치** — PER·PBR·EPS·ROE·배당수익률·주당배당금·시가총액, **미래 PER**, **애널리스트 목표주가·투자의견**, 연간 실적 막대그래프
- **뉴스** — 종목별 최신 뉴스(한국어/영어)
- **포트폴리오** — 매수가·수량 입력 → 종목별·통화별·원화 통합 손익 (localStorage)
- 다크/화이트 테마 전환, 초보자 설명 툴팁, 설치형 PWA

관심종목·보유종목·테마는 **기기별 localStorage**에 저장 (계정·서버 저장 없음).

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
