export type Market = 'KR' | 'US'

export interface FocusTicker {
  ticker: string
  name: string
  short: string
  market: Market
  kind: 'stock' | 'etf'
}

// 당분간 이 3종목만 (기획 §9)
export const TICKERS: FocusTicker[] = [
  { ticker: '005930', name: '삼성전자', short: '삼성전자', market: 'KR', kind: 'stock' },
  { ticker: '000660', name: 'SK하이닉스', short: 'SK하이닉스', market: 'KR', kind: 'stock' },
  { ticker: 'KORU', name: 'KORU · 한국 3배 ETF', short: 'KORU', market: 'US', kind: 'etf' },
]
