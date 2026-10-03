import test from 'node:test'
import assert from 'node:assert/strict'
import { CALENDAR_QUERY_POLICY, CALENDAR_EARNINGS_TICKERS, calendarScopeTickers, filterCalendarEvents, calendarEventTicker, calendarTickerHref, calendarTimestamp, koreanDate, shiftDate, shiftMonth, monthRange, monthDays, eventTime, sortedEvents, type CalendarEvent } from './calendar.ts'
import { QueryClient, QueryObserver, focusManager } from '@tanstack/react-query'
import type { Holding } from './holdings.ts'

test('한국 날짜는 UTC 자정이 아니라 한국 자정에 바뀐다', () => {
  assert.equal(koreanDate(new Date('2026-10-04T14:59:00Z')), '2026-10-04')
  assert.equal(koreanDate(new Date('2026-10-04T15:00:00Z')), '2026-10-05')
})

test('월 범위와 달력은 연말·윤년을 처리한다', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01')
  assert.equal(shiftMonth('2026-01', -1), '2025-12')
  assert.deepEqual(monthRange('2028-02'), { start: '2028-02-01', end: '2028-02-29' })
  assert.equal(monthDays('2028-02').filter(Boolean).length, 29)
  assert.equal(monthDays('2026-10')[4], '2026-10-01')
  assert.equal(monthDays('2026-10').length % 7, 0)
  assert.equal(shiftDate('2026-12-30', 6), '2027-01-05')
})

const event: CalendarEvent = { id: 'test', title: '실적 발표', category: 'earnings', country: 'US', startAt: '2026-10-04T20:00:00Z', date: '2026-10-05', timeStatus: 'confirmed', importance: 'high', source: '공식 출처', sourceUrl: 'https://example.com' }
const aapl = CALENDAR_EARNINGS_TICKERS.find((ticker) => ticker.ticker === 'AAPL')!
const nvda = CALENDAR_EARNINGS_TICKERS.find((ticker) => ticker.ticker === 'NVDA')!

test('관심·보유 필터는 지원 기업의 미국 주식만 선택하며 보유 수량 0은 제외한다', () => {
  const watchlist = [aapl, aapl, { ...nvda, market: 'KR' as const }, { ...nvda, kind: 'etf' as const }, { ...aapl, ticker: 'INTC' }]
  const holdings: Holding[] = [{ ...nvda, qty: 2, avg: 100 }, { ...aapl, qty: 0, avg: 100 }]
  assert.deepEqual(calendarScopeTickers('watchlist', watchlist, holdings).map((ticker) => ticker.ticker), ['AAPL'])
  assert.deepEqual(calendarScopeTickers('holdings', watchlist, holdings).map((ticker) => ticker.ticker), ['NVDA'])
  assert.equal(calendarScopeTickers('all', [], []).length, 7)
  assert.deepEqual(calendarScopeTickers('watchlist', [{ ...aapl, ticker: 'aapl' }], []), [aapl])
})

test('내 종목 실적과 공통 거시 일정을 선택적으로 조합하고 공개 응답은 바꾸지 않는다', () => {
  const events: CalendarEvent[] = [
    { ...event, id: 'aapl', ticker: 'AAPL' }, { ...event, id: 'nvda', ticker: 'NVDA' },
    { ...event, id: 'kr-collision', ticker: 'AAPL', country: 'KR' },
    { ...event, id: 'fed', category: 'rates' }, { ...event, id: 'cpi', category: 'economic' },
  ]
  const original = structuredClone(events)
  assert.deepEqual(filterCalendarEvents(events, 'watchlist', [aapl], true).map((item) => item.id), ['aapl', 'fed', 'cpi'])
  assert.deepEqual(filterCalendarEvents(events, 'holdings', [nvda], false).map((item) => item.id), ['nvda'])
  assert.deepEqual(filterCalendarEvents(events, 'holdings', [], false), [])
  assert.deepEqual(filterCalendarEvents(events, 'holdings', [], true).map((item) => item.id), ['fed', 'cpi'])
  assert.deepEqual(filterCalendarEvents(events, 'all', [], false), events)
  assert.deepEqual(events, original)
})

test('실적 일정의 종목 링크는 미등록 기업도 열 수 있고 개인 보유 정보는 포함하지 않는다', () => {
  const resolved = calendarEventTicker({ ...event, ticker: 'nvda' })!
  assert.equal(resolved.ticker, 'NVDA')
  assert.equal(calendarEventTicker({ ...event, ticker: 'NVDA', country: 'KR' }), undefined)
  assert.equal(calendarEventTicker({ ...event, ticker: 'NVDA', category: 'economic' }), undefined)
  assert.equal(calendarEventTicker({ ...event, ticker: 'UNKNOWN' }), undefined)
  for (const view of ['tech', 'signal'] as const) {
    const href = new URL(calendarTickerHref(resolved, view), 'https://example.com')
    const params = new URLSearchParams(href.hash.slice(1))
    assert.equal(href.pathname, '/')
    assert.equal(href.search, '')
    assert.deepEqual(Object.fromEntries(params), { tab: view, ticker: 'NVDA', market: 'US', name: '엔비디아', kind: 'stock' })
  }
})
test('발표 시각은 한국시간으로 표시하며 현지 날짜만 주어진 일정과 구분한다', () => {
  assert.equal(eventTime(event), '05:00 확정 · 한국시간')
  assert.equal(eventTime({ ...event, timeStatus: 'tentative' }), '05:00 예상 · 한국시간')
  assert.equal(eventTime({ ...event, startAt: null, timeStatus: 'date_only' }), '시간 미정 · 현지 날짜')
  assert.equal(eventTime({ ...event, startAt: null, timeStatus: 'tentative' }), '예상 · 시간 미정 · 현지 날짜')
})

test('일정은 날짜와 실제 발표시각으로 정렬하고 시간 미정은 마지막에 둔다', () => {
  const events = [{ ...event, id: 'unknown', startAt: null }, { ...event, id: 'late', startAt: '2026-10-04T20:00:00Z' }, { ...event, id: 'early', startAt: '2026-10-05T01:00:00+09:00' }]
  assert.deepEqual(sortedEvents(events).map((item) => item.id), ['early', 'late', 'unknown'])
})

test('자료 확인 시각은 한국시간으로 표시하고 누락·잘못된 날짜는 숨긴다', () => {
  assert.match(calendarTimestamp('2026-10-04T15:30:00Z')!, /10\. 5\. 00:30 KST/)
  assert.equal(calendarTimestamp(undefined), null)
  assert.equal(calendarTimestamp('unknown'), null)
})

test('오래 열린 캘린더는 화면 복귀 때 정정 일정을 받고 수동 조회도 가능하다', async (context) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  let now = Date.now()
  context.mock.method(Date, 'now', () => now)
  let calls = 0
  const observer = new QueryObserver(client, {
    queryKey: ['calendar', '2026-10-01', '2026-10-31'],
    queryFn: async () => ({ date: ++calls === 1 ? '2026-10-29' : '2026-10-30' }),
    ...CALENDAR_QUERY_POLICY,
  })
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve))
  client.mount()
  const unsubscribe = observer.subscribe(() => {})
  try {
    await flush()
    assert.equal(calls, 1)
    assert.equal(observer.getCurrentResult().data?.date, '2026-10-29')
    // A healthy calendar formerly stayed at the first value after seven hours.
    now += 7 * 60 * 60 * 1000
    focusManager.setFocused(false)
    focusManager.setFocused(true)
    await flush()
    assert.equal(calls, 2)
    assert.equal(observer.getCurrentResult().data?.date, '2026-10-30')
    await observer.refetch()
    assert.equal(calls, 3)
    // The visible page also polls; hidden tabs must not create background load.
    assert.equal(observer.options.refetchInterval, 30 * 60 * 1000)
    assert.equal(observer.options.refetchIntervalInBackground, false)
  } finally {
    unsubscribe()
    client.unmount()
    client.clear()
    focusManager.setFocused(undefined)
  }
})
