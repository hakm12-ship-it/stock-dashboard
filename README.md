# 스톡 인사이트 (Stock Insight)

2026-09 리뉴얼: 데스크톱 리서치 화면·모바일 탐색, 검색/입력/백업 검증, URL 복원, 알림 API 인증을 정비했습니다. [진단·변경·검증 기록](RENEWAL.md), [디자인 기준](design-system.md)을 참고하세요. 운영 알림 스케줄러 인증 설정은 [배포 안내](DEPLOY.md)에 있습니다. 이 작업에서는 배포하지 않았습니다.

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

관심종목·보유종목·테마·신호규칙은 **기기별 localStorage**에 저장합니다(계정·서버 저장 없음). 무료 운영에서는 상시 깨우기와 정기 텔레그램 스케줄러를 기본 비활성화하며, 유휴 상태 후 첫 접속에는 시작 시간이 걸릴 수 있습니다.

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

5173 포트가 다른 프로젝트에서 사용 중이면 `npm run dev -- --port 5186 --strictPort`로 실행하세요. 이번 검수의 주소는 `http://localhost:5186`입니다. API는 8000 포트를 사용합니다. Node 24 이상, Python 3.12 환경에서 검증했습니다. 기존 가상환경이 없다면 프로젝트 루트에서 `python -m venv backend/.venv`를 만든 뒤 `backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt`로 설치하고, backend 폴더에서 `.venv/Scripts/python.exe -m uvicorn main:app --port 8000`을 실행하세요.

검증: frontend에서 `npm run build`, `npm run lint`, `npm test`. 루트에서 `python scripts/verify_ui.py`는 Python Playwright와 Chromium이 설치된 경우 브라우저 회귀 검수를 실행합니다. `python scripts/verify_api.py`는 실행 중인 로컬 백엔드를 읽기 전용으로 확인합니다. 결과와 이미지는 `artifacts/renewal/`에 저장됩니다.

- 개발: `http://localhost:5173` (또는 같은 Wi-Fi에서 `http://<PC-IP>:5173`)
- 프로덕션 미리보기: `cd frontend; npm run build` 후 백엔드 `http://localhost:8000`

## 검사

**로직 검사** — 네트워크도 서버도 없이 몇 초면 끝난다. 코드를 고쳤으면 이걸 먼저 돌린다.

```powershell
cd backend
..\stock-dashboard\.venv\Scripts\python.exe -m unittest discover -s tests -t .
```

지키는 것: 알림 중복 방지(재시작을 끼워 넣어도 같은 알림이 두 번 가지 않는지 — 2026-08에 실제로 깨졌던 부분), 포트폴리오 진단 계산(레버리지를 기초자산 테마로 접는지, 환율 환산, LLM 캐시 키 안정성), TTL 캐시의 적중·만료·청소·동시성.

**프런트 계산 검사** — 추가 매수 계산 등 순수 로직. Node 24가 TypeScript를 그대로 돌려서 테스트 러너를 따로 안 깐다.

```powershell
cd frontend
node --test src/lib/*.test.ts
```

**스모크 테스트** — 배포 전에 응답 *구조*가 달라졌는지 본다. 서버가 떠 있어야 하고 외부 API를 실제로 부른다.

```powershell
cd backend
..\stock-dashboard\.venv\Scripts\python.exe smoke_test.py --save baseline.json   # 고치기 전
..\stock-dashboard\.venv\Scripts\python.exe smoke_test.py --check baseline.json  # 고친 뒤
```

정상적으로도 흔들리는 항목: `signal-history`(백테스트 창), `ai-briefing`·`related-insight`·`portfolio-review`(Gemini 할당량), `market-top`(개장 전 빈 배열).

## 배포 (Render, 무료)

`render.yaml` 청사진으로 Docker 단일 서비스 배포. 자세한 절차는 [DEPLOY.md](DEPLOY.md).

### 공개 AI 호출 한도

종목·관련종목·포트폴리오 AI 분석은 각 카드의 **요청 버튼을 눌렀을 때만** 조회합니다. 화면 진입, 종목 이동, 포커스 복귀, 전체 새로고침으로 생성하지 않습니다. 포트폴리오 수치 진단은 AI와 별도로 자동 조회합니다.

종목 브리핑·관련종목 해설·포트폴리오 코멘트는 하나의 생성 예산을 공유합니다. 기본값은 **한국시간 하루 20회, 동시 생성 1회**이며 실패한 모델 호출도 횟수에 포함합니다. `PUBLIC_AI_DAILY_LIMIT` 환경변수로 0~100회를 지정할 수 있습니다. 0이면 새 생성을 중단하며, 100 초과는 100으로 제한합니다. API 키가 없으면 모델을 호출하지 않습니다.

종목 브리핑은 시장·종목 기준 3시간, 관련종목 해설은 30분, 포트폴리오 코멘트는 구성 기준 2시간 재사용합니다. 표시 이름이나 시세의 작은 변동으로 캐시를 우회할 수 없습니다. 일반 실패는 2분, 할당량·인증 오류(429·401·403)는 전체 공개 AI에 최소 15분 대기를 적용합니다. 한도 도달 시 시세·규칙 기반 분석은 계속 사용할 수 있습니다.

이 예산과 캐시는 **단일 서버 프로세스 기준**이며 재시작·재배포 시 초기화됩니다. 영구적인 비용 상한이 아니며, 여러 worker/인스턴스로 확장할 때는 공유 저장소의 예산 관리가 필요합니다. 정기 텔레그램 브리핑은 별도의 날짜·시간대 캐시를 사용하며 이 설정으로 활성화되지 않습니다.

## 방문형 경제 브리핑과 거래일 관리

홈 경제 브리핑은 한국시간 07:00·12:00·18:00 구간별 RSS 제목과 원문 링크를 보여줍니다. 현재 시간대 첫 조회에서만 수집하며 AI·텔레그램·상시 스케줄러를 호출하지 않습니다. 최근 7일의 수집된 구간을 메모리에 보관하므로 서버 재시작 후에는 과거 기록이 없을 수 있습니다. 수집하지 않은 과거 시간대를 현재 기사로 채우지 않습니다.

장 상태와 정규장 시세 자동 조회는 `frontend/src/lib/marketSchedule.ts`의 거래소 일정을 사용합니다. 현재 검증 범위는 한국 2026년, 미국 2026~2028년입니다. 한국거래소의 다음 연도 일정과 임시 휴장·특별 거래시간 공지를 확인한 뒤 이 파일과 회귀 테스트를 갱신해야 합니다. 아직 등록되지 않은 연도 및 거래시간 미확인 특별일에는 ‘확인 필요’를 표시하고 정규장 시세 자동 조회를 중단합니다. 수동 조회는 가능합니다. 일정 기반 표시이며 실시간 거래정지 확인 기능은 아닙니다. 24시간 거래되는 코인·Hyperliquid 참고 가격은 별도로 갱신합니다.

차트의 봉 간격과 이동평균·볼린저·지지저항 표시 설정은 브라우저에 저장됩니다. 개인 데이터 백업은 기존 v2 형식을 유지하며 마지막 **다운로드 요청 시각**과 이후 변경 여부를 표시합니다. 브라우저가 실제 파일 저장 완료를 통지하지 않으므로 다운로드 폴더에서 파일을 확인해야 합니다.

## 기술 스택

React · TypeScript · Vite · Tailwind CSS · lightweight-charts · TanStack Query · FastAPI · Python
