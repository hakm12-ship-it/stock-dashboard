import type { Candle } from './api'

/** 일봉 → 주봉 집계 (주 시작=월요일). */
export function toWeekly(candles: Candle[]): Candle[] {
  const out: Candle[] = []
  let cur: Candle | null = null
  let curKey = ''
  for (const c of candles) {
    const d = new Date(c.time + 'T00:00:00')
    const monday = new Date(d)
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    const key = monday.toISOString().slice(0, 10)
    if (key !== curKey) {
      if (cur) out.push(cur)
      cur = { ...c }
      curKey = key
    } else if (cur) {
      cur.high = Math.max(cur.high, c.high)
      cur.low = Math.min(cur.low, c.low)
      cur.close = c.close
      cur.volume += c.volume
    }
  }
  if (cur) out.push(cur)
  return out
}
