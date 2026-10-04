import test from 'node:test'
import assert from 'node:assert/strict'
import type { FocusTicker } from '../data/tickers.ts'
import type { Candle, WatchlistData } from './api.ts'
import type { CalendarEvent } from './calendar.ts'
import { myDayTickers, significantMoves, myEarnings, matchingNews, newsItemsForDay } from './myDay.ts'
const now = new Date('2026-10-04T10:00:00+09:00')
const aapl: FocusTicker = { ticker: 'AAPL', name: '애플', short: '애플', market: 'US', kind: 'stock' }
const candles = (close: number, time = '2026-10-02'): Candle[] => [
  { time: '2026-10-01', open: 100, high: 100, low: 100, close: 100, volume: 1 },
  { time, open: close, high: close, low: close, close, volume: 1 },
]
test('holdings outside the watchlist join the summary without quantities or duplicate instruments', () => {
  const members = myDayTickers([aapl, { ...aapl, ticker: 'IXIC', kind: 'index' }], [
    { ...aapl, qty: 1, avg: 100 }, { ...aapl, ticker: 'NVDA', name: '엔비디아', qty: 2, avg: 80 },
  ])
  assert.deepEqual(members.map((t) => t.ticker), ['AAPL', 'NVDA'])
  assert.ok(!('qty' in members[1]))
})
test('moves reuse the newest cached quote, rank absolute moves and omit stale or invalid quotes', () => {
  const rows = new Map<string, WatchlistData>([['AAPL', { ticker: 'AAPL', candles: candles(110), stale: true }]])
  assert.equal(significantMoves([aapl], rows, new Map(), now).available, 0)
  const result = significantMoves([aapl], rows, new Map([['US:AAPL', candles(95, '2026-10-03')]]), now)
  assert.equal(result.available, 1)
  assert.equal(result.moves[0].asOf, '2026-10-03')
  assert.ok(Math.abs(result.moves[0].pct + 5) < 0.001)
  for (const bad of [candles(100, '2026-09-01'), candles(NaN), candles(110, '2026-10-05')]) {
    assert.equal(significantMoves([aapl], new Map([['AAPL', { ticker: 'AAPL', candles: bad }]]), new Map(), now).available, 0)
  }
})
test('earnings match supported US stock identity and exclude elapsed announcements', () => {
  const base: CalendarEvent = { id: 'e', title: '실적', category: 'earnings', country: 'US', ticker: 'AAPL', date: '2026-10-04', startAt: null, timeStatus: 'date_only', importance: 'high', source: 'IR', sourceUrl: 'https://example.com' }
  assert.equal(myEarnings([base, { ...base, id: 'old', startAt: '2026-10-04T00:00:00Z' }, { ...base, id: 'future', date: '2026-10-11' }], [aapl], now).length, 1)
  assert.equal(myEarnings([base], [{ ...aapl, market: 'KR' }], now).length, 0)
})
test('news requires an instrument mention, fresh timestamps and safe links; duplicates merge', () => {
  const base = { title: 'Apple reports earnings', url: 'https://example.com/story', source: 'RSS', publishedAt: '2026-10-04T00:30:00Z' }
  const stories = matchingNews([base, { ...base, url: 'https://example.com/duplicate' }, { ...base, title: 'General market report' },
    { ...base, title: 'Apple future', publishedAt: '2026-10-05T00:00:00Z' }, { ...base, title: 'Apple old', publishedAt: '2026-10-01T00:00:00Z' },
    { ...base, title: 'Apple unsafe', url: 'javascript:alert(1)' }], [aapl], now)
  assert.equal(stories.length, 1)
  assert.equal(stories[0].tickers[0].ticker, 'AAPL')
  assert.equal(newsItemsForDay([{ title: '애플 실적', link: base.url, source: 'RSS', published: '2026-10-04 09:30' }])[0].publishedAt, '2026-10-04T09:30:00+09:00')
})
