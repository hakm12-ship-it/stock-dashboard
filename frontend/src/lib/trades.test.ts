import assert from 'node:assert/strict'
import test from 'node:test'
import { realizedPnL, type Trade } from './trades.ts'

const buy: Trade = { id: 'buy', ticker: 'NVDA', name: '엔비디아', market: 'US', date: '2026-10-01', side: 'buy', qty: 10, price: 100 }
const sell: Trade = { ...buy, id: 'sell', side: 'sell', price: 150 }

test('same-day recorded execution order is independent of input or backup array order', () => {
  const orderedBuy = { ...buy, sequence: 1 }, orderedSell = { ...sell, sequence: 2 }
  assert.deepEqual(realizedPnL([orderedBuy, orderedSell]), { totals: { KR: 0, US: 500 }, issues: [] })
  assert.deepEqual(realizedPnL([orderedSell, orderedBuy]), realizedPnL([orderedBuy, orderedSell]))
})
test('unknown or duplicate mixed-day order never produces a guessed profit or zero', () => {
  for (const trades of [[buy, sell], [sell, buy], [{ ...buy, sequence: 1 }, { ...sell, sequence: 1 }]]) {
    const result = realizedPnL(trades)
    assert.equal(result.totals.US, null)
    assert.equal(result.issues[0].reason, 'ambiguous_order')
  }
})
test('excess selling and missing opening purchases hold the entire currency total', () => {
  for (const trades of [[sell], [buy, { ...sell, date: '2026-10-02', qty: 20 }]]) {
    const result = realizedPnL(trades)
    assert.equal(result.totals.US, null)
    assert.equal(result.issues[0].reason, 'missing_purchase')
  }
})
test('legacy different-day records retain average-cost results and independent markets remain usable', () => {
  const krBuy: Trade = { ...buy, market: 'KR', ticker: '005930' }
  const krSell: Trade = { ...sell, market: 'KR', ticker: '005930', date: '2026-10-02' }
  const result = realizedPnL([sell, krBuy, krSell])
  assert.equal(result.totals.KR, 500)
  assert.equal(result.totals.US, null)
})
test('fractional-share rounding does not invent an excess-sale issue', () => {
  const trades: Trade[] = [{ ...buy, qty: 0.1 }, { ...buy, id: 'buy2', qty: 0.2 }, { ...sell, date: '2026-10-02', qty: 0.3 }]
  assert.equal(realizedPnL(trades).issues.length, 0)
  assert.ok(Math.abs(realizedPnL(trades).totals.US! - 15) < 1e-9)
})
