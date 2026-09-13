import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseBackup, positive, validDate } from './validation.ts'
import { persist } from './storage.ts'
const h = { ticker: '005930', name: '삼성전자', market: 'KR', kind: 'stock', qty: 10, avg: 100 }
test('legacy backup remains readable without replacing missing trade history', () => {
  const d = parseBackup(JSON.stringify({ v: 1, holdings: [h], customTickers: [] }))
  assert.deepEqual(d.holdings, [h])
  assert.equal(d.trades, undefined)
})
test('invalid, negative and duplicate holdings cannot replace stored data', () => {
  for (const holdings of [
    [{ ...h, qty: -1 }],
    [{ ...h, market: 'XX' }],
    [{ ...h, avg: '10' }],
    [h, h],
    [null],
    {},
  ]) {
    assert.throws(() => parseBackup(JSON.stringify({ holdings })))
  }
})
test('restore checks every present list before accepting any of them', () => {
  assert.throws(() => parseBackup(JSON.stringify({ holdings: [h], customTickers: [{}] })))
  assert.throws(() => parseBackup(JSON.stringify({ v: 99, holdings: [h] })))
  assert.throws(() => parseBackup('{}'))
})
test('v2 backup retains trade records and validates calendar dates', () => {
  const t = {
    id: 'one',
    ticker: h.ticker,
    name: h.name,
    market: h.market,
    side: 'buy',
    qty: 1,
    price: 10,
    date: '2026-09-13',
  }
  assert.deepEqual(parseBackup(JSON.stringify({ v: 2, trades: [t] })).trades, [t])
  assert.throws(() => parseBackup(JSON.stringify({ trades: [{ ...t, date: '2026-02-30' }] })))
  assert.equal(validDate('2024-02-29'), true)
  assert.equal(validDate('2026-02-29'), false)
})
test('non-finite values and zero are rejected', () => {
  for (const value of [Infinity, NaN, -1, 0, '', null]) assert.equal(positive(value), false)
  assert.equal(positive(0.1), true)
})
test('failed multi-list storage restores earlier writes', () => {
  const data = new Map([
    ['holdings', 'original'],
    ['trades-v1', 'journal'],
  ])
  let once = true
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    removeItem: (key: string) => {
      data.delete(key)
    },
    setItem: (key: string, value: string) => {
      if (key === 'trades-v1' && once) {
        once = false
        throw new Error('quota')
      }
      data.set(key, value)
    },
  } as Storage
  assert.equal(persist({ holdings: [h], 'trades-v1': [] }, storage), false)
  assert.equal(data.get('holdings'), 'original')
  assert.equal(data.get('trades-v1'), 'journal')
})
