import type { FocusTicker } from '../data/tickers.ts'
import type { Holding } from './holdings.ts'

export type CalendarCategory = 'rates' | 'economic' | 'earnings'
export type CalendarScope = 'all' | 'watchlist' | 'holdings'
export type CalendarTickerView = 'tech' | 'signal'

// Matches the public provider's supported earnings universe. Personal filters
// never expand this universe or send the user's watchlist/holdings to the API.
export const CALENDAR_EARNINGS_TICKERS: readonly FocusTicker[] = [
  ['AAPL', '애플'], ['MSFT', '마이크로소프트'], ['GOOGL', '알파벳'], ['AMZN', '아마존'],
  ['META', '메타'], ['NVDA', '엔비디아'], ['TSLA', '테슬라'],
].map(([ticker, name]) => ({ ticker, name, short: name, market: 'US', kind: 'stock' }))

export const CALENDAR_SCOPES: Record<CalendarScope, string> = {
  all: '전체 일정', watchlist: '관심종목', holdings: '보유종목',
}

export function calendarScopeTickers(scope: CalendarScope, watchlist: readonly FocusTicker[], holdings: readonly Holding[]): readonly FocusTicker[] {
  if (scope === 'all') return CALENDAR_EARNINGS_TICKERS
  const members = scope === 'watchlist' ? watchlist : holdings.filter((holding) => holding.qty > 0)
  return CALENDAR_EARNINGS_TICKERS.filter((ticker) => members.some((member) =>
    member.market === ticker.market && member.kind === 'stock' && member.ticker.toUpperCase() === ticker.ticker,
  ))
}

export function filterCalendarEvents(events: readonly CalendarEvent[], scope: CalendarScope, tickers: readonly FocusTicker[], includeMacro: boolean): CalendarEvent[] {
  return events.filter((event) => {
    if (scope === 'all') return true
    if (event.category !== 'earnings') return includeMacro
    return event.country === 'US' && Boolean(event.ticker && tickers.some((ticker) => ticker.ticker === event.ticker?.toUpperCase()))
  })
}

export function calendarEventTicker(event: CalendarEvent): FocusTicker | undefined {
  return event.category === 'earnings' && event.country === 'US'
    ? CALENDAR_EARNINGS_TICKERS.find((ticker) => ticker.ticker === event.ticker?.toUpperCase()) : undefined
}

export function calendarTickerHref(ticker: FocusTicker, view: CalendarTickerView): string {
  return '/#' + new URLSearchParams({ tab: view, ticker: ticker.ticker, market: ticker.market, name: ticker.name, kind: ticker.kind }).toString()
}

export interface CalendarEvent {
  id: string
  title: string
  category: CalendarCategory
  country: 'US' | 'KR'
  startAt: string | null
  date: string
  timeStatus: 'confirmed' | 'tentative' | 'date_only'
  importance: 'high' | 'medium'
  source: string
  sourceUrl: string
  ticker?: string
  description?: string
}

export interface CalendarSource {
  name: string
  url: string
  status: 'ok' | 'error'
  message?: string
  checkedAt?: string
  dataAsOf?: string
  nextRefreshAt?: string
}

export interface CalendarResponse {
  events: CalendarEvent[]
  sources: CalendarSource[]
  fetchedAt: string
  timezone: 'Asia/Seoul'
}

export interface CalendarNotificationStatus {
  enabled: boolean
  configured: boolean
  ready: boolean
  status: string
  timezone: string
  times: string[]
  schedulerActive: boolean
  schedule: { tomorrowCalendar: string; eventReminderMinutes: number }
}

export const CALENDAR_CATEGORIES: Record<CalendarCategory, string> = {
  rates: '주요 금리',
  economic: '경제 지표',
  earnings: '빅테크 실적',
}
export const CALENDAR_CACHE_MS = 30 * 60 * 1000
// Revalidate visible calendars without bypassing the server's per-source cache.
export const CALENDAR_QUERY_POLICY = {
  staleTime: CALENDAR_CACHE_MS,
  refetchInterval: CALENDAR_CACHE_MS,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
} as const

export function calendarTimestamp(value: string | undefined): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value)) + ' KST'
}

export function koreanDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type)?.value).join('-')
}

export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function shiftMonth(month: string, direction: number): string {
  const value = new Date(`${month}-01T00:00:00Z`)
  value.setUTCMonth(value.getUTCMonth() + direction)
  return value.toISOString().slice(0, 7)
}

export function monthRange(month: string) {
  return { start: `${month}-01`, end: shiftDate(`${shiftMonth(month, 1)}-01`, -1) }
}

export function monthDays(month: string): (string | null)[] {
  const { start, end } = monthRange(month)
  const leading = new Date(`${start}T00:00:00Z`).getUTCDay()
  const days = Number(end.slice(-2))
  const count = Math.ceil((leading + days) / 7) * 7
  return Array.from({ length: count }, (_, index) => {
    const day = index - leading + 1
    return day >= 1 && day <= days ? `${month}-${String(day).padStart(2, '0')}` : null
  })
}

export function eventTime(event: CalendarEvent): string {
  if (!event.startAt || event.timeStatus === 'date_only') return `${event.timeStatus === 'tentative' ? '예상 · ' : ''}시간 미정 · 현지 날짜`
  const time = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(event.startAt))
  return `${time}${event.timeStatus === 'tentative' ? ' 예상' : ' 확정'} · 한국시간`
}

export function dateLabel(date: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'UTC', month: 'long', day: 'numeric', weekday: 'short',
  }).format(new Date(`${date}T00:00:00Z`))
}

export function sortedEvents(events: CalendarEvent[]): CalendarEvent[] {
  const time = (event: CalendarEvent) => event.startAt ? Date.parse(event.startAt) : Infinity
  return [...events].sort((a, b) => a.date.localeCompare(b.date) || time(a) - time(b) || a.title.localeCompare(b.title))
}
