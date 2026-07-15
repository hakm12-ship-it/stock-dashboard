export type Market = 'KR' | 'US'

export interface FocusTicker {
  ticker: string
  name: string
  short: string
  market: Market
  kind: 'stock' | 'etf' | 'index'
  indexName?: 'KOSPI' | 'NASDAQ' // 지수는 실시간 지수 API로 현재값 조회
  lev?: string // 레버리지 배수 표기 (예: '2X', '3X')
}

// 중점 종목 + 지수 (기획 §9, 확장중)
export const TICKERS: FocusTicker[] = [
  { ticker: '005930', name: '삼성전자', short: '삼성전자', market: 'KR', kind: 'stock' },
  { ticker: '000660', name: 'SK하이닉스', short: 'SK하이닉스', market: 'KR', kind: 'stock' },
  { ticker: '0193T0', name: 'KODEX SK하이닉스 레버리지', short: '하닉 레버', market: 'KR', kind: 'etf', lev: '2X' },
  { ticker: 'KORU', name: 'KORU · 한국 3배 ETF', short: 'KORU', market: 'US', kind: 'etf', lev: '3X' },
  { ticker: 'SOXL', name: 'SOXL · 반도체 3배 ETF', short: 'SOXL', market: 'US', kind: 'etf', lev: '3X' },
  { ticker: 'KS11', name: '코스피', short: '코스피', market: 'KR', kind: 'index', indexName: 'KOSPI' },
  { ticker: 'IXIC', name: '나스닥', short: '나스닥', market: 'US', kind: 'index', indexName: 'NASDAQ' },
]
