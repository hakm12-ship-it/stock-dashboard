import type { Market } from '../data/tickers'

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
}

const KEY = 'trades-v1'

export function loadTrades(): Trade[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Trade[]) : []
  } catch {
    return []
  }
}

export function saveTrades(list: Trade[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

/** 평균단가법으로 매도 시 실현손익 계산 (통화별 합계) */
export function realizedPnL(trades: Trade[]): Record<Market, number> {
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date))
  const pos = new Map<string, { qty: number; avg: number }>()
  const out: Record<Market, number> = { KR: 0, US: 0 }
  for (const t of sorted) {
    const k = `${t.market}-${t.ticker}`
    const p = pos.get(k) ?? { qty: 0, avg: 0 }
    if (t.side === 'buy') {
      const cost = p.avg * p.qty + t.price * t.qty
      p.qty += t.qty
      p.avg = p.qty > 0 ? cost / p.qty : 0
    } else {
      const sellQty = Math.min(t.qty, p.qty) // 보유 초과 매도는 보유분까지만 계산
      out[t.market] += (t.price - p.avg) * sellQty
      p.qty -= sellQty
      if (p.qty <= 0) {
        p.qty = 0
        p.avg = 0
      }
    }
    pos.set(k, p)
  }
  return out
}
