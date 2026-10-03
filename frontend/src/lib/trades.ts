import { isTrade } from './validation.ts'
import { persist } from './storage.ts'
import type { Market } from '../data/tickers.ts'

export interface Trade {
  id: string
  date: string // YYYY-MM-DD
  ticker: string
  name: string
  market: Market
  side: 'buy' | 'sell'
  qty: number
  price: number
  memo?: string
  sequence?: number // 같은 종목·날짜의 실제 거래 순서. 기존 기록에는 없을 수 있다.
}

const KEY = 'trades-v1'

export function loadTrades(): Trade[] {
  try {
    const raw = localStorage.getItem(KEY)
    const value: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(value) ? value.filter(isTrade) : []
  } catch {
    return []
  }
}

export function saveTrades(list: Trade[]): boolean {
  return persist({ 'trades-v1': list })
}

export interface TradeIssue {
  market: Market
  ticker: string
  name: string
  date: string
  reason: 'ambiguous_order' | 'missing_purchase'
}
export interface RealizedPnL {
  totals: Record<Market, number | null>
  issues: TradeIssue[]
}

/** Never publish a partial or guessed P/L when cost basis or transaction order is unknown. */
export function realizedPnL(trades: Trade[]): RealizedPnL {
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date) || (a.sequence ?? 0) - (b.sequence ?? 0))
  const byDay = new Map<string, Trade[]>()
  for (const trade of trades) {
    const key = `${trade.market}-${trade.ticker}-${trade.date}`
    byDay.set(key, [...(byDay.get(key) ?? []), trade])
  }
  const issues: TradeIssue[] = []
  const blocked = new Set<string>()
  for (const daily of byDay.values()) {
    if (!daily.some((trade) => trade.side === 'buy') || !daily.some((trade) => trade.side === 'sell')) continue
    if (daily.some((trade) => trade.sequence == null) || new Set(daily.map((trade) => trade.sequence)).size !== daily.length) {
      const trade = daily[0]
      issues.push({ ...trade, reason: 'ambiguous_order' })
      blocked.add(`${trade.market}-${trade.ticker}`)
    }
  }
  const pos = new Map<string, { qty: number; avg: number }>()
  const totals: Record<Market, number | null> = { KR: 0, US: 0 }
  for (const t of sorted) {
    const k = `${t.market}-${t.ticker}`
    if (blocked.has(k)) continue
    const p = pos.get(k) ?? { qty: 0, avg: 0 }
    if (t.side === 'buy') {
      const cost = p.avg * p.qty + t.price * t.qty
      p.qty += t.qty
      p.avg = p.qty > 0 ? cost / p.qty : 0
    } else {
      if (t.qty - p.qty > Math.max(1, t.qty, p.qty) * Number.EPSILON * 8) {
        issues.push({ ...t, reason: 'missing_purchase' })
        blocked.add(k)
        continue
      }
      const sellQty = Math.min(t.qty, p.qty)
      totals[t.market]! += (t.price - p.avg) * sellQty
      p.qty -= sellQty
      if (p.qty <= 0) {
        p.qty = 0
        p.avg = 0
      }
    }
    pos.set(k, p)
  }
  for (const issue of issues) totals[issue.market] = null
  return { totals, issues }
}
