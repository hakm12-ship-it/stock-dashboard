import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldRefreshMarketQuery } from './marketPolling.ts'

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
test('early close stops all ordinary US market polling', () => {
  assert.equal(shouldRefreshMarketQuery(['prices', 'NVDA'], new Date('2026-11-27T18:00:00Z')), false)
  assert.equal(shouldRefreshMarketQuery(['marketTop', 'up', 'NASDAQ'], new Date('2026-11-27T18:00:00Z')), false)
  assert.equal(shouldRefreshMarketQuery(['marketTop', 'up', 'CRYPTO'], new Date('2026-11-27T18:00:00Z')), true)
})
