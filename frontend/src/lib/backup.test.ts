import assert from 'node:assert/strict'
import test from 'node:test'
import { BACKUP_REQUEST_KEY, createBackupSnapshot, loadBackupStatus, recordBackupRequest } from './backup.ts'
import { DATA_REVISION_KEY, mutateList, persist, type StorageLock } from './storage.ts'
import { isHolding, parseBackup } from './validation.ts'

const holding = { ticker: '005930', name: 'Samsung', market: 'KR' as const, kind: 'stock', qty: 10, avg: 70000 }
function setup() {
  const data = new Map<string, string>()
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
  } as Storage
  let pending: Promise<unknown> = Promise.resolve()
  const lock: StorageLock = (work) => { const result = pending.then(work); pending = result.catch(() => {}); return result }
  return { data, storage, lock }
}

test('backup reads latest locked records, preserves legacy data and v2 restore format', async () => {
  const { storage, lock } = setup()
  const oldTrade = { id: 'old', ticker: '005930', name: 'Samsung', market: 'KR', date: '2026-10-01', side: 'buy', qty: 1, price: 70000 }
  storage.setItem('trades-v1', JSON.stringify([oldTrade]))
  const addition = mutateList('holdings', isHolding, () => [holding], storage, lock)
  const snapshot = await createBackupSnapshot(storage, lock)
  await addition
  assert.ok(snapshot.ok)
  assert.deepEqual(parseBackup(JSON.stringify(snapshot.value.data)), { v: 2, holdings: [holding], customTickers: [], trades: [oldTrade] })
  assert.deepEqual(loadBackupStatus(storage), { requestedAt: null, changed: false })
  assert.equal((await recordBackupRequest(snapshot.value, '2026-10-04T00:00:00Z', storage, lock)).ok, true)
  assert.deepEqual(loadBackupStatus(storage), { requestedAt: '2026-10-04T00:00:00Z', changed: false })
})

test('changes made between snapshot and download request remain marked as needing backup', async () => {
  const { storage, lock } = setup()
  const snapshot = await createBackupSnapshot(storage, lock)
  assert.ok(snapshot.ok)
  await mutateList('holdings', isHolding, () => [holding], storage, lock)
  await recordBackupRequest(snapshot.value, '2026-10-04T00:00:00Z', storage, lock)
  assert.equal(loadBackupStatus(storage).changed, true)
})

test('only changes to backed-up records dirty a backup; no-op writes and preferences do not', async () => {
  const { storage, lock } = setup()
  await mutateList('holdings', isHolding, () => [holding], storage, lock)
  const snapshot = await createBackupSnapshot(storage, lock)
  assert.ok(snapshot.ok)
  await recordBackupRequest(snapshot.value, '2026-10-04T00:00:00Z', storage, lock)
  persist({ 'chart-preferences-v1': { timeframe: 'W' } }, storage)
  await mutateList('holdings', isHolding, (latest) => [...latest], storage, lock)
  assert.equal(loadBackupStatus(storage).changed, false)
  await mutateList('holdings', isHolding, (latest) => latest.map((h) => ({ ...h, qty: 11 })), storage, lock)
  assert.equal(loadBackupStatus(storage).changed, true)
})

test('failed revision write rolls records back and invalid metadata never claims a backup exists', () => {
  const { data, storage } = setup()
  data.set('holdings', JSON.stringify([holding]))
  const setItem = storage.setItem
  storage.setItem = (key, value) => { if (key === DATA_REVISION_KEY) throw new Error('quota'); setItem(key, value) }
  assert.equal(persist({ holdings: [] }, storage), false)
  assert.deepEqual(JSON.parse(storage.getItem('holdings')!), [holding])
  data.set(BACKUP_REQUEST_KEY, JSON.stringify({ requestedAt: 'bad', revision: null }))
  assert.deepEqual(loadBackupStatus(storage), { requestedAt: null, changed: false })
})

test('a corrupt saved list blocks export instead of backing up an empty replacement', async () => {
  const { storage, lock } = setup()
  storage.setItem('holdings', 'invalid')
  assert.equal((await createBackupSnapshot(storage, lock)).ok, false)
  assert.equal(storage.getItem('holdings'), 'invalid')
})

test('empty-list initialization and failed request-history saving preserve records and backup state', async () => {
  const { storage, lock } = setup()
  const snapshot = await createBackupSnapshot(storage, lock)
  assert.ok(snapshot.ok)
  await recordBackupRequest(snapshot.value, '2026-10-04T00:00:00Z', storage, lock)
  persist({ holdings: [], customTickers: [], 'trades-v1': [] }, storage)
  assert.equal(loadBackupStatus(storage).changed, false)
  const setItem = storage.setItem
  storage.setItem = (key, value) => { if (key === BACKUP_REQUEST_KEY) throw new Error('quota'); setItem(key, value) }
  assert.equal((await recordBackupRequest(snapshot.value, '2026-10-05T00:00:00Z', storage, lock)).ok, false)
  assert.equal(loadBackupStatus(storage).requestedAt, '2026-10-04T00:00:00Z')
  assert.equal(storage.getItem('holdings'), '[]')
})
