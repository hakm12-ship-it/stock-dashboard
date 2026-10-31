import assert from 'node:assert/strict'
import test from 'node:test'
import { marketsPolledSince, refreshMarketQuery, shouldRefreshMarketQuery } from './marketPolling.ts'

test('US open hours do not refresh KR stocks on a Korean holiday', () => {
  const now = new Date('2026-10-09T23:00:00+09:00')
  for (const key of [['prices', '005930'], ['prices', '0193T0'], ['index', 'KOSPI'], ['groupStocks', 'theme'], ['watchlist', '005930,000660'], ['ai-briefing', 'US', 'NVDA']]) {
    assert.equal(shouldRefreshMarketQuery(key, now), false, JSON.stringify(key))
  }
  assert.equal(shouldRefreshMarketQuery(['prices', 'NVDA'], now), true)
  assert.equal(shouldRefreshMarketQuery(['marketTop', 'up', 'NASDAQ'], now), true)
  assert.equal(shouldRefreshMarketQuery(['watchlist', '005930,NVDA'], now), true)
})
test('KR regular hours refresh only relevant market queries', () => {
  const now = new Date('2026-10-06T10:00:00+09:00')
  assert.equal(shouldRefreshMarketQuery(['prices', 'KS11'], now), true)
  assert.equal(shouldRefreshMarketQuery(['marketTop', 'up', 'KOSPI'], now), true)
  assert.equal(shouldRefreshMarketQuery(['prices', 'NVDA'], now), false)
  assert.equal(shouldRefreshMarketQuery(['related-insight', '005930'], now), false)
})
test('early close keeps US polling only through the grace window after 13:00 ET', () => {
  assert.equal(shouldRefreshMarketQuery(['prices', 'NVDA'], new Date('2026-11-27T13:10:00-05:00')), true)
  assert.equal(shouldRefreshMarketQuery(['prices', 'NVDA'], new Date('2026-11-27T13:40:00-05:00')), false)
  assert.equal(shouldRefreshMarketQuery(['marketTop', 'up', 'NASDAQ'], new Date('2026-11-27T13:40:00-05:00')), false)
  assert.equal(shouldRefreshMarketQuery(['prices', 'NVDA'], new Date('2026-11-27T16:10:00-05:00')), false)
  assert.equal(shouldRefreshMarketQuery(['marketTop', 'up', 'CRYPTO'], new Date('2026-11-27T13:40:00-05:00')), true)
})
test('KR polling continues for 30 minutes after the 15:30 close to fetch the closing price', () => {
  const grace = new Date('2026-10-30T15:40:00+09:00')
  for (const key of [['prices', '005930'], ['index', 'KOSPI'], ['watchlist', '005930,000660'], ['marketTop', 'up', 'KOSPI'], ['groupStocks', 'theme'], ['fx'], ['macro']]) {
    assert.equal(shouldRefreshMarketQuery(key, grace), true, JSON.stringify(key))
  }
  assert.equal(shouldRefreshMarketQuery(['prices', 'NVDA'], grace), false)
  assert.equal(shouldRefreshMarketQuery(['prices', '005930'], new Date('2026-10-30T15:59:59+09:00')), true)
  assert.equal(shouldRefreshMarketQuery(['prices', '005930'], new Date('2026-10-30T16:00:00+09:00')), false)
  for (const key of [['prices', '005930'], ['index', 'KOSPI'], ['fx']]) {
    assert.equal(shouldRefreshMarketQuery(key, new Date('2026-10-30T16:10:00+09:00')), false, JSON.stringify(key))
  }
})
test('US polling continues for 30 minutes after the 16:00 ET close', () => {
  const grace = new Date('2026-10-30T16:10:00-04:00')
  for (const key of [['prices', 'NVDA'], ['index', 'NASDAQ'], ['marketTop', 'up', 'NASDAQ'], ['watchlist', '005930,NVDA']]) {
    assert.equal(shouldRefreshMarketQuery(key, grace), true, JSON.stringify(key))
  }
  assert.equal(shouldRefreshMarketQuery(['prices', '005930'], grace), false)
  for (const key of [['prices', 'NVDA'], ['index', 'NASDAQ'], ['fx']]) {
    assert.equal(shouldRefreshMarketQuery(key, new Date('2026-10-30T16:40:00-04:00')), false, JSON.stringify(key))
  }
})
test('no post-close polling on holidays, weekends or unconfirmed sessions', () => {
  // 한글날(KR 휴장), 추수감사절(US 휴장), 토요일, 수능일(KR 시간 미확인)
  assert.equal(shouldRefreshMarketQuery(['prices', '005930'], new Date('2026-10-09T15:40:00+09:00')), false)
  assert.equal(shouldRefreshMarketQuery(['index', 'KOSPI'], new Date('2026-10-09T15:40:00+09:00')), false)
  assert.equal(shouldRefreshMarketQuery(['prices', 'NVDA'], new Date('2026-11-26T16:10:00-05:00')), false)
  assert.equal(shouldRefreshMarketQuery(['index', 'NASDAQ'], new Date('2026-11-26T16:10:00-05:00')), false)
  assert.equal(shouldRefreshMarketQuery(['prices', '005930'], new Date('2026-10-31T15:40:00+09:00')), false)
  assert.equal(shouldRefreshMarketQuery(['prices', 'NVDA'], new Date('2026-10-31T16:10:00-04:00')), false)
  assert.equal(shouldRefreshMarketQuery(['prices', '005930'], new Date('2026-11-19T15:40:00+09:00')), false)
})
test('a hidden tab notices a session that opened and closed while it was away', () => {
  // 장전(08:30)에 받아 둔 값으로 숨겨졌다가 장마감 뒤(16:30)에 돌아온 경우
  const kr = marketsPolledSince(Date.parse('2026-10-29T08:30:00+09:00'), new Date('2026-10-29T16:30:00+09:00'))
  assert.deepEqual(kr, { kr: true, us: false })
  assert.equal(refreshMarketQuery(['prices', '005930'], kr), true)
  assert.equal(refreshMarketQuery(['index', 'NASDAQ'], kr), false)
  // 한국 저녁에 숨겼다가 다음 날 아침에 돌아오면 그 사이 끝난 미국장을 다시 받는다
  const us = marketsPolledSince(Date.parse('2026-10-29T21:00:00+09:00'), new Date('2026-10-30T08:00:00+09:00'))
  assert.deepEqual(us, { kr: false, us: true })
  assert.equal(refreshMarketQuery(['index', 'NASDAQ'], us), true)
  assert.equal(refreshMarketQuery(['watchlist', '005930,000660'], us), false)
})
test('a gap over the weekend or with no check missed falls back to the current status', () => {
  const weekend = marketsPolledSince(Date.parse('2026-10-31T10:00:00+09:00'), new Date('2026-11-01T20:00:00+09:00'))
  assert.deepEqual(weekend, { kr: false, us: false })
  assert.equal(refreshMarketQuery(['prices', '005930'], weekend), false)
  assert.equal(refreshMarketQuery(['marketTop', 'up', 'CRYPTO'], weekend), true)
  const now = new Date('2026-10-30T16:10:00+09:00')
  assert.deepEqual(marketsPolledSince(now.getTime(), now), { kr: false, us: false })
  const open = new Date('2026-10-30T10:00:00+09:00')
  assert.deepEqual(marketsPolledSince(open.getTime(), open), { kr: true, us: false })
})
