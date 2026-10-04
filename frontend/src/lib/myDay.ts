import type { FocusTicker } from '../data/tickers.ts'
import type { Holding } from './holdings.ts'
import type { Candle, WatchlistData, NewsItem } from './api.ts'
import type { CalendarEvent } from './calendar.ts'
import { koreanDate, shiftDate, sortedEvents } from './calendar.ts'

export function myDayTickers(watchlist: readonly FocusTicker[], holdings: readonly Holding[]): FocusTicker[] {
  const all = new Map(watchlist.map((ticker) => [`${ticker.market}:${ticker.ticker}`, ticker]))
  for (const holding of holdings.filter((item) => item.qty > 0)) {
    const key = `${holding.market}:${holding.ticker}`
    if (!all.has(key)) all.set(key, { ticker: holding.ticker, market: holding.market, name: holding.name, short: holding.name, kind: holding.kind === 'etf' ? 'etf' : 'stock' })
  }
  return [...all.values()].filter((ticker) => ticker.kind !== 'index')
}

export function significantMoves(tickers: readonly FocusTicker[], rows: ReadonlyMap<string, WatchlistData>, cached: ReadonlyMap<string, Candle[]>, now = new Date()) {
  const today = koreanDate(now)
  const moves: { ticker: FocusTicker; pct: number; asOf: string }[] = []
  let available = 0
  for (const ticker of tickers) {
    const row = rows.get(ticker.ticker)
    const fallback = cached.get(`${ticker.market}:${ticker.ticker}`)
    const candles = (fallback?.at(-1)?.time ?? '') > (row?.candles?.at(-1)?.time ?? '') ? fallback : row?.candles ?? fallback
    const last = candles?.at(-1), previous = candles?.at(-2)
    if (!last || !previous || !/^\d{4}-\d{2}-\d{2}$/.test(last.time) || !Number.isFinite(Date.parse(last.time))
      || last.time < shiftDate(today, -7) || last.time > today || !Number.isFinite(last.close) || last.close <= 0
      || !Number.isFinite(previous.close) || previous.close <= 0 || (row?.stale && candles === row.candles)) continue
    available++
    const pct = (last.close / previous.close - 1) * 100
    if (Math.abs(pct) >= 3) moves.push({ ticker, pct, asOf: last.time })
  }
  return { available, moves: moves.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 5) }
}

export function myEarnings(events: readonly CalendarEvent[], tickers: readonly FocusTicker[], now = new Date()) {
  const today = koreanDate(now), end = shiftDate(today, 6)
  return sortedEvents(events.filter((event) => event.category === 'earnings' && event.country === 'US'
    && event.date >= today && event.date <= end && (!event.startAt || Date.parse(event.startAt) >= now.getTime())
    && tickers.some((ticker) => ticker.market === 'US' && ticker.kind === 'stock' && ticker.ticker === event.ticker))).slice(0, 3)
}

const aliases: Record<string, string[]> = {
  AAPL: ['애플', 'apple'], MSFT: ['마이크로소프트', 'microsoft'], GOOGL: ['알파벳', 'alphabet', '구글', 'google'],
  AMZN: ['아마존', 'amazon'], META: ['메타', 'meta'], NVDA: ['엔비디아', 'nvidia'], TSLA: ['테슬라', 'tesla'],
  '005930': ['삼성전자', 'samsung electronics'], '000660': ['SK하이닉스', '하이닉스', 'sk hynix'],
}
function mentions(title: string, ticker: FocusTicker) {
  const terms = [...(aliases[ticker.ticker] ?? []), ticker.name, ticker.short, ticker.market === 'US' ? ticker.ticker : ''].filter((s) => s.length >= 2)
  return terms.some((term) => /^[a-z0-9 .-]+$/i.test(term)
    ? new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(title)
    : title.toLowerCase().includes(term.toLowerCase()))
}

export interface MyDayNews { title: string; url: string; source: string; publishedAt: string; tickers: FocusTicker[] }
export function matchingNews(items: readonly { title: string; url: string; source: string; publishedAt: string }[], tickers: readonly FocusTicker[], now = new Date()): MyDayNews[] {
  const seen = new Set<string>()
  return [...items].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).flatMap((item) => {
    const at = Date.parse(item.publishedAt)
    const members = tickers.filter((ticker) => mentions(item.title, ticker))
    let url: URL
    try { url = new URL(item.url) } catch { return [] }
    if (!['http:', 'https:'].includes(url.protocol) || !Number.isFinite(at) || at > now.getTime() || at < now.getTime() - 24 * 3600_000
      || !members.length || seen.has(item.title.trim().toLowerCase())) return []
    seen.add(item.title.trim().toLowerCase())
    return [{ ...item, tickers: members }]
  }).slice(0, 3)
}

export function newsItemsForDay(items: readonly NewsItem[]) {
  return items.map((item) => ({ title: item.title, url: item.link, source: item.source,
    publishedAt: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(item.published) ? item.published.replace(' ', 'T') + ':00+09:00' : '' }))
}
