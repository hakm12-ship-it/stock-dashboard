# 스톡 인사이트 — 프론트엔드 (React + Vite)

스톡 인사이트 웹앱의 프론트엔드입니다. 전체 개요·아키텍처·배포는 [루트 README](../README.md) 참고.

## 개발

```bash
npm install
npm run dev      # 개발 서버 (5173) — /api 는 backend(8000)로 프록시
npm run build    # 프로덕션 빌드 (dist/) — tsc 타입체크 포함
npm run preview  # 빌드 결과 미리보기
```

> 백엔드(FastAPI, 8000)가 먼저 떠 있어야 `/api` 데이터가 로드됩니다.

## 구조

```
src/
├─ App.tsx              # 레이아웃 · 상태 · 시트(검색/보유/비교)
├─ components/          # IndexStrip · StockHeader · BottomNav · 차트 · Help · 시트 등
├─ views/               # HomeView · SignalView · TechnicalView · FundamentalView · NewsView
├─ lib/                 # api(백엔드 호출) · format · market · holdings · customTickers
└─ data/tickers.ts      # 기본 종목 목록
```

## 스택

React · TypeScript · Tailwind CSS · lightweight-charts · TanStack Query · PWA(manifest + service worker)
