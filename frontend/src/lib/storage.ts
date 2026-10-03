/// <reference lib="dom" />
export const DATA_REVISION_KEY = 'stock-insight-data-revision'
const accountKeys = ['holdings', 'customTickers', 'trades-v1']

/** Persist first. Roll back earlier keys if a multi-list restore cannot finish. */
export function persist(entries: Record<string, unknown>, storage?: Storage): boolean {
  const previous = new Map<string, string | null>()
  try {
    storage ??= localStorage
    const writes = { ...entries }
    if (accountKeys.some((key) => key in writes && JSON.stringify(writes[key]) !== (storage!.getItem(key) ?? '[]'))) {
      writes[DATA_REVISION_KEY] = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    }
    for (const key of Object.keys(writes)) previous.set(key, storage.getItem(key))
    for (const [key, value] of Object.entries(writes)) storage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    if (!storage) return false
    for (const [key, value] of previous) {
      try {
        if (value === null) storage.removeItem(key)
        else storage.setItem(key, value)
      } catch {
        /* storage may be unavailable */
      }
    }
    return false
  }
}

export type StorageResult<T> = { ok: true; value: T } | { ok: false }
export type StorageLock = <T>(work: () => T) => Promise<T>

/** All account-data mutations share one origin-wide lock, including multi-list restores. */
export const withStorageLock: StorageLock = async (work) => {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request('stock-insight-data', work)
  }
  // IndexedDB read/write transactions serialize across tabs on browsers without Web Locks.
  if (typeof indexedDB === 'undefined') throw new Error('Storage locking unavailable')
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('stock-insight-storage-lock', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('lock')
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Storage lock blocked'))
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction('lock', 'readwrite')
      let value: ReturnType<typeof work>
      const lock = transaction.objectStore('lock').get('account-data')
      lock.onsuccess = () => {
        try {
          value = work()
          transaction.objectStore('lock').put(1, 'account-data')
        } catch (error) {
          transaction.abort()
          reject(error)
        }
      }
      transaction.oncomplete = () => { db.close(); resolve(value) }
      transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error) }
    }
  })
}

export function readStoredList<T>(storage: Storage, key: string, valid: (value: unknown) => value is T): T[] {
  const value: unknown = JSON.parse(storage.getItem(key) ?? '[]')
  if (!Array.isArray(value) || !value.every(valid)) throw new Error(`Invalid saved ${key}`)
  return value
}

/** Read inside the lock. Never use a component's possibly stale array as the write base. */
export async function mutateStorage<T>(
  update: (storage: Storage) => { entries: Record<string, unknown>; value: T },
  storage?: Storage,
  lock: StorageLock = withStorageLock,
): Promise<StorageResult<T>> {
  try {
    return await lock(() => {
      const target = storage ?? localStorage
      const { entries, value } = update(target)
      return persist(entries, target) ? { ok: true as const, value } : { ok: false as const }
    })
  } catch {
    return { ok: false }
  }
}

export function mutateList<T>(
  key: string,
  valid: (value: unknown) => value is T,
  update: (latest: T[]) => T[],
  storage?: Storage,
  lock?: StorageLock,
) {
  return mutateStorage((target) => {
    const next = update(readStoredList(target, key, valid))
    if (!next.every(valid)) throw new Error('Invalid record')
    return { entries: { [key]: next }, value: next }
  }, storage, lock)
}
