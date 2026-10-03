import assert from 'node:assert/strict'
import test from 'node:test'
import { mutateList, mutateStorage, type StorageLock } from './storage.ts'
import { isHolding, isTrade, parseBackup } from './validation.ts'

function setup() {
  const data = new Map<string, string>()
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
  } as Storage
  let pending: Promise<unknown> = Promise.resolve()
  const lock: StorageLock = (work) => {
    const result = pending.then(work)
    pending = result.catch(() => {})
    return result
  }
  return { data, storage, lock }
}
const samsung = { ticker: '005930', name: '삼성전자', market: 'KR' as const, kind: 'stock', qty: 10, avg: 70000 }
const nvidia = { ticker: 'NVDA', name: '엔비디아', market: 'US' as const, kind: 'stock', qty: 2, avg: 100 }

test('concurrent additions read latest data inside the shared lock', async () => {
  const { storage, lock } = setup()
  const results = await Promise.all([
    mutateList('holdings', isHolding, (latest) => [...latest, samsung], storage, lock),
    mutateList('holdings', isHolding, (latest) => [...latest, nvidia], storage, lock),
  ])
  assert.ok(results.every((result) => result.ok))
  assert.deepEqual(JSON.parse(storage.getItem('holdings')!).map((holding: { ticker: string }) => holding.ticker), ['005930', 'NVDA'])
})

test('a stale-tab edit or delete preserves records added by another tab', async () => {
  const { storage, lock } = setup()
  storage.setItem('holdings', JSON.stringify([samsung]))
  await mutateList('holdings', isHolding, (latest) => [...latest, nvidia], storage, lock)
  await mutateList('holdings', isHolding, (latest) => latest.map((holding) => holding.ticker === samsung.ticker ? { ...holding, qty: 20 } : holding), storage, lock)
  await mutateList('holdings', isHolding, (latest) => latest.filter((holding) => holding.ticker !== samsung.ticker), storage, lock)
  assert.deepEqual(JSON.parse(storage.getItem('holdings')!), [nvidia])
})

test('backup replacement and a simultaneous addition use the same lock', async () => {
  const { storage, lock } = setup()
  await Promise.all([
    mutateStorage(() => ({ entries: { holdings: [samsung], 'trades-v1': [] }, value: true }), storage, lock),
    mutateList('holdings', isHolding, (latest) => [...latest, nvidia], storage, lock),
  ])
  assert.deepEqual(JSON.parse(storage.getItem('holdings')!), [samsung, nvidia])
})

test('corrupt existing data cannot be silently replaced by an empty write base', async () => {
  const { storage, lock } = setup()
  storage.setItem('holdings', 'broken-json')
  const result = await mutateList('holdings', isHolding, (latest) => [...latest, samsung], storage, lock)
  assert.equal(result.ok, false)
  assert.equal(storage.getItem('holdings'), 'broken-json')
})

test('legacy records survive mutation and backup restore without invented transaction order', async () => {
  const { storage, lock } = setup()
  const old = { id: 'old', date: '2026-10-01', ticker: 'NVDA', name: '엔비디아', market: 'US' as const, side: 'buy' as const, qty: 1, price: 100 }
  const restored = parseBackup(JSON.stringify({ v: 2, trades: [old] }))
  storage.setItem('trades-v1', JSON.stringify(restored.trades))
  await mutateList('trades-v1', isTrade, (latest) => [...latest, { ...old, id: 'new', date: '2026-10-02', sequence: 1 }], storage, lock)
  const saved = JSON.parse(storage.getItem('trades-v1')!)
  assert.deepEqual(saved[0], old)
  assert.equal(saved[1].sequence, 1)
  assert.throws(() => parseBackup(JSON.stringify({ trades: [{ ...old, sequence: -1 }] })))
})
