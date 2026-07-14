# 스톡 인사이트 — React 전환 기획서

> 목표: Streamlit의 디자인 한계를 넘어 **트레이딩앱급 프리미엄 UI**로 재구축.
> 분석 로직(Python)은 그대로 재사용하고, **화면만 React로** 새로 만든다.

## 0. 핵심 원칙
- **백엔드 Python 유지** — 데이터 라이브러리(yfinance·FinanceDataReader)가 파이썬 전용. 기존 `analysis/`·`data/` 모듈을 API로 감싸 재사용.
- **프론트만 신규** — React로 완전 커스텀 디자인.
- **현 Streamlit 버전은 계속 운영** — React 완성 전까지 친구들 데모 링크 유지. 완성 후 교체.

---

## 1. 아키텍처

```
[React 프론트엔드]  (Vite + TypeScript + Tailwind)
        │  fetch /api/*
        ▼
[FastAPI 백엔드]   기존 analysis/·data/ 모듈 재사용
        │
   yfinance · FinanceDataReader · Google News RSS
```

**배포 단순화안**: FastAPI가 `/api/*`(JSON) + 빌드된 React 정적파일을 함께 서빙 → **단일 서비스**로 배포(Render/Railway 등). 프론트/백 따로 관리 안 해도 됨.

---

## 2. 기술 스택

| 영역 | 선택 | 이유 |
|---|---|---|
| 빌드 | **Vite + React + TypeScript** | 빠르고 표준적 |
| 스타일 | **Tailwind CSS** | 디자인 시스템 빠르게, 일관성 |
| 컴포넌트 | **shadcn/ui** (Radix 기반) | 접근성 좋은 프리미엄 드롭다운·탭·다이얼로그 |
| 가격 차트 | **lightweight-charts** (TradingView 제작) | 진짜 트레이딩앱 캔들·지표 |
| 보조 차트 | Recharts | 실적 막대·예상범위 밴드 등 간단한 것 |
| 데이터 페칭 | **TanStack Query** | API 캐싱·로딩상태 깔끔 |
| 백엔드 | **FastAPI** + 기존 모듈 | 분석 로직 재사용 |

**사전 준비물**: Node.js 설치 필요 (현재 PC엔 없음 → 다음 세션 첫 작업으로 winget 설치).

---

## 3. API 설계 (FastAPI)

기존 모듈을 얇게 감싸는 엔드포인트:

| 메서드 | 경로 | 반환 | 재사용 모듈 |
|---|---|---|---|
| GET | `/api/symbols?market=KR\|US&q=삼성` | 종목 검색결과 | `data/symbols.py` |
| GET | `/api/prices?ticker=005930&period=3m` | OHLCV 배열 | `load_prices` |
| GET | `/api/indicators?ticker=...` | RSI·MACD·볼린저·이평 | `analysis/technical.py` |
| GET | `/api/valuation?market=KR&ticker=...` | PER·PBR·EPS·ROE·시총 | `analysis/fundamental.py` |
| GET | `/api/trend?...` | 연간 실적 | `revenue_trend` |
| GET | `/api/signal?...` | 종합신호·지지/저항 | `analysis/signal.py` |
| GET | `/api/forecast?...` | 예상 변동 범위 | `analysis/forecast.py` |
| GET | `/api/news?market=KR&name=삼성전자` | 뉴스 목록 | `data/news.py` |

- CORS 허용, 응답 캐싱(기존 TTL 유지), 에러 시 명확한 메시지.

---

## 4. 화면 구성 (프론트)

```
┌───────────────────────────────────────────────┐
│  상단바: 로고 · 종목검색(자동완성) · KR/US · ⭐   │
├─────────────┬─────────────────────────────────┤
│  종목 헤더   │  종목명 · 티커칩 · 대형 가격 · 등락  │
├─────────────┴─────────────────────────────────┤
│  탭: 종합신호 · 기술적 · 기본적 · 뉴스            │
│  ┌───────────────────────────────────────────┐ │
│  │  각 탭 내용 (패널 카드 그리드)              │ │
│  └───────────────────────────────────────────┘ │
└───────────────────────────────────────────────┘
```

- **종합신호**: 판정 배지 + 예상변동범위(부채꼴) + 지지/저항 + 밸류에이션 카드
- **기술적**: lightweight-charts 캔들 + 이평·볼린저 + RSI/MACD 별도 페인
- **기본적**: 밸류에이션 카드 그리드 + 실적 막대
- **뉴스**: 카드형 뉴스 리스트

**관심종목**: 브라우저 localStorage 저장 → **사용자별 분리 자동 해결** (지금 Streamlit의 공유문제 없음).

---

## 5. 디자인 방향 (유지·강화)
- **프리미엄 핀테크 터미널**: 잉크블랙 배경 + 앰버 포인트 + IBM Plex(모노 숫자).
- 이제 완전 커스텀이니: 패널 카드 그림자·헤어라인, 부드러운 hover·전환, 스켈레톤 로딩, 반응형(모바일 우선).
- 상승 빨강 / 하락 파랑 (KR 관례) 유지.

---

## 6. 단계별 로드맵

- **Phase A — 백엔드 API**: Node·FastAPI 준비 → 기존 모듈을 엔드포인트로 노출 → 각 API 응답 검증.
- **Phase B — 프론트 뼈대**: Vite+React+TS+Tailwind 스캐폴딩 → 디자인 토큰 → 상단바·헤더·탭 레이아웃 셸 → API 클라이언트.
- **Phase C — 차트**: lightweight-charts로 캔들+이평+볼린저, RSI/MACD 페인.
- **Phase D — 나머지 탭**: 기본적·종합신호·예상범위·뉴스.
- **Phase E — 마무리**: 관심종목(localStorage), 로딩·에러 상태, 반응형 점검, 배포.

---

## 7. 저장소 구조 (예정)
```
stock-insight/            # (현 stock-dashboard 유지하며 병행 or 새 폴더)
├─ backend/
│  ├─ main.py             # FastAPI (analysis/·data/ import)
│  ├─ analysis/ …         # 기존 모듈 이전
│  └─ data/ …
└─ frontend/
   ├─ src/
   │  ├─ components/      # Header, Tabs, MetricCard, PriceChart …
   │  ├─ pages/ or views/
   │  ├─ api/             # fetch 훅 (TanStack Query)
   │  └─ theme/           # 디자인 토큰
   └─ index.html
```

## 8. 다음 세션 시작 체크리스트
1. Node.js 설치 (`winget install OpenJS.NodeJS.LTS`)
2. `backend/` — FastAPI로 기존 모듈 감싸 `/api/prices` 하나부터 동작 확인
3. `frontend/` — Vite 스캐폴딩 + Tailwind + 상단바/헤더 셸
4. 캔들차트(lightweight-charts) 한 종목 띄우기 → 여기까지가 첫 마일스톤

---

## 9. 스코프 보완 (2026-07-15) — 우선 3종목 집중

당분간 **딱 3종목만** 중점적으로 (검색 기능은 유지하되 기본 포커스):

| 종목 | 티커 | 비고 |
|---|---|---|
| 삼성전자 | `005930` (KR) | 미래 PER 표시 대상 |
| SK하이닉스 | `000660` (KR) | 미래 PER 표시 대상 |
| KORU | `KORU` (US) | Direxion 한국 3배 레버리지 ETF — ETF라 PER 없음, 변동성 큼 |

### 미래 PER (Forward PER) — 삼성전자·하이닉스
- 정의: `미래PER(t) = 현재가 ÷ 예상EPS(t년 후)`, **t = 1/2년만** (3년은 제외 — 컨센서스 부족). **현재 PER과 나란히** 표시해 "시간이 갈수록 싸지는지" 확인.
- 예상 EPS 출처: **yfinance 애널리스트 컨센서스**(`Ticker.earnings_estimate` → 올해·내년 avg EPS). **실제 컨센서스만 사용**(성장가정 추정 안 함).
- ⚠️ 컨센서스도 전망 변경에 따라 바뀜. 투자조언 아님 문구 유지.
- **다음 세션 첫 확인**: yfinance가 `005930.KS`/`000660.KS`의 forward EPS(올해/내년)를 실제 주는지 API로 검증 후 UI 확정.

### 시장 개요 — 지수 (KOSPI + NASDAQ)
- 상단에 **KOSPI·NASDAQ** 현재값·등락률·미니차트 스트립.
- 티커: FinanceDataReader `KS11`(코스피), `IXIC`(나스닥 종합). (yfinance면 `^KS11`, `^IXIC`)
- 새 API 예정: `/api/index?name=KOSPI|NASDAQ`.

### 화면 반영 요약
- 상단: **지수 스트립**(KOSPI·NASDAQ) + 3종목 빠른 전환 칩.
- 삼성/하이닉스 상세: 밸류에이션에 **미래 PER 1/2년 행** 추가.
- KORU: PER 계열 숨김, 가격·기술·예상범위 위주(레버리지 ETF라 변동성 큼 안내).
