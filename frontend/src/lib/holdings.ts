import { isHolding } from './validation.ts'
import { persist } from './storage.ts'
import type { Market } from '../data/tickers.ts'

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
    const value: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(value) ? value.filter(isHolding) : []
  } catch {
    return []
  }
}

export function saveHoldings(list: Holding[]): boolean {
  return persist({ holdings: list })
}
