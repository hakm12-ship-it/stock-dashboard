import type { Market } from '../data/tickers'

export interface Holding {
  ticker: string
  name: string
  market: Market
  kind: string
  qty: number
  avg: number // 평균 매수가
}

const KEY = 'holdings'

export function loadHoldings(): Holding[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Holding[]) : []
  } catch {
    return []
  }
}

export function saveHoldings(list: Holding[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}
