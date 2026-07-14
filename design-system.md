# 스톡 인사이트 — 디자인 시스템 (React 버전)

> 컨셉: **프리미엄 핀테크 터미널** — 잉크블랙 배경 · 앰버 포인트(최소 사용) · IBM Plex(숫자는 모노).
> 다음 세션에 Tailwind `theme.extend`로 그대로 옮긴다.

## 1. 컬러 토큰

| 토큰 | HEX | 용도 |
|---|---|---|
| `ink` | `#0A0C10` | 페이지 배경 |
| `surface` | `#12151C` | 카드·패널 |
| `surface-2` | `#171B24` | hover·상승 표면 |
| `border` | `#232833` | 헤어라인 경계 |
| `text` | `#E8EBF0` | 기본 텍스트 |
| `muted` | `#8B94A3` | 보조 텍스트·라벨 |
| `accent` | `#E0A63C` | 앰버 포인트 (탭 언더라인·포커스·배지에만) |
| `up` | `#F23645` | 상승 (KR 관례: 빨강) |
| `down` | `#2E86FF` | 하락 (KR 관례: 파랑) |

원칙: **앰버는 화면당 2~3곳만.** 나머지는 잉크/서피스/헤어라인으로 조용하게. 상승/하락 색은 데이터에만.

## 2. 타이포그래피

- **본문/UI**: `IBM Plex Sans KR` (400/500/600/700) — Latin+Hangul.
- **숫자·티커·가격**: `IBM Plex Mono` (400/500/600) + `font-variant-numeric: tabular-nums`.
- 로드: Google Fonts (`IBM+Plex+Sans+KR`, `IBM+Plex+Mono`).

**타입 스케일** (rem): 헤더가격 2.0 / h1 1.5 / h2 1.15 / 본문 0.95 / 라벨 0.72(uppercase, letter-spacing .08em) / 캡션 0.8.

## 3. 간격 · 모양

- 라운드: 카드 `12px`, 칩·버튼 `8px`, 배지 `5px`.
- 패널 패딩: `16px`. 카드 간격(gap): `12px`.
- 컨테이너 최대폭: `1120px`, 모바일 우선 반응형.
- 경계: 항상 `1px solid border`. 그림자는 아주 은은하게(`0 1px 2px rgba(0,0,0,.3)`) 또는 생략.

## 4. 차트 색 (lightweight-charts / Recharts 공통)

| 요소 | 색 |
|---|---|
| 캔들 상승 | `up` 몸통+테두리 단색 |
| 캔들 하락 | `down` 몸통+테두리 단색 |
| MA20 | `#E0B84D` (골드) |
| MA60 | `#8A94A3` (muted) |
| RSI 라인 | `accent` |
| RSI 70/30 기준선 | `up`/`down` 점선 |
| MACD 라인 | `accent` / Signal `muted` / 히스토그램 up·down |
| 예상범위 밴드 | 회색 반투명 (`rgba(140,148,162,.10/.24)`), 현재가 중심선 점선 |
| 차트 배경 | 투명(패널색 위) · 그리드 `#1A1F28` 아주 옅게 |

## 5. 컴포넌트 스펙

- **MetricCard**: surface 배경 + border + radius12 + 패딩. 라벨(uppercase muted 0.72) 위, 값(mono 1.4rem 600) 아래, 델타(mono, up/down색).
- **Tabs**: 밑줄형. 비활성 muted, 활성 text + `accent` 2px 언더라인.
- **Panel**: surface + border + radius12 + 패딩16. 상단에 작은 uppercase 섹션 라벨(muted).
- **Badge(BETA 등)**: 앰버 테두리(투명 배경) + mono 0.65rem.
- **Button**: surface + border, hover 시 border→accent.
- **VerdictPill(매수/중립/매도)**: 매수=up 톤, 매도=down 톤, 중립=muted. 채도 낮게.

## 6. Tailwind 매핑 (다음 세션 참고)
```js
// tailwind.config.js theme.extend.colors
{ ink:'#0A0C10', surface:'#12151C', 'surface-2':'#171B24',
  border:'#232833', text:'#E8EBF0', muted:'#8B94A3',
  accent:'#E0A63C', up:'#F23645', down:'#2E86FF' }
// fontFamily: sans:['IBM Plex Sans KR',...], mono:['IBM Plex Mono',...]
```
