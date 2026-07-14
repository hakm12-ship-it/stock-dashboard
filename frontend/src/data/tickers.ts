export type Market = 'KR' | 'US'

export interface FocusTicker {
  ticker: string
  name: string
  short: string
  market: Market
  kind: 'stock' | 'etf' | 'index'
}

// 중점 종목 + 지수 (기획 §9, 확장중)
export const TICKERS: FocusTicker[] = [
  { ticker: '005930', name: '삼성전자', short: '삼성전자', market: 'KR', kind: 'stock' },
  { ticker: '000660', name: 'SK하이닉스', short: 'SK하이닉스', market: 'KR', kind: 'stock' },
  { ticker: 'KORU', name: 'KORU · 한국 3배 ETF', short: 'KORU', market: 'US', kind: 'etf' },
  { ticker: 'SOXL', name: 'SOXL · 반도체 3배 ETF', short: 'SOXL', market: 'US', kind: 'etf' },
  { ticker: 'KS11', name: '코스피', short: '코스피', market: 'KR', kind: 'index' },
  { ticker: 'IXIC', name: '나스닥', short: '나스닥', market: 'US', kind: 'index' },
]
