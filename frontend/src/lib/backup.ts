import { DATA_REVISION_KEY, mutateStorage, readStoredList, type StorageLock } from './storage.ts'
import { isHolding, isTicker, isTrade, type Backup } from './validation.ts'

export const BACKUP_REQUEST_KEY = 'backup-request-v1'
export interface BackupSnapshot { data: Backup; revision: string | null }

/** A download request is observable; successful disk storage is not. */
export function loadBackupStatus(storage?: Storage): { requestedAt: string | null; changed: boolean } {
  try {
    const target = storage ?? localStorage
    const value: unknown = JSON.parse(target.getItem(BACKUP_REQUEST_KEY) ?? 'null')
    if (!value || typeof value !== 'object' || !('requestedAt' in value) || !('revision' in value)
      || typeof value.requestedAt !== 'string' || !Number.isFinite(Date.parse(value.requestedAt))
      || (value.revision !== null && typeof value.revision !== 'string')) {
      return { requestedAt: null, changed: false }
    }
    return { requestedAt: value.requestedAt, changed: value.revision !== target.getItem(DATA_REVISION_KEY) }
  } catch {
    return { requestedAt: null, changed: false }
  }
}

/** Read every list under the same lock used by mutations and restores. */
export function createBackupSnapshot(storage?: Storage, lock?: StorageLock) {
  return mutateStorage<BackupSnapshot>((target) => ({
    entries: {},
    value: {
      data: {
        v: 2,
        holdings: readStoredList(target, 'holdings', isHolding),
        customTickers: readStoredList(target, 'customTickers', isTicker),
        trades: readStoredList(target, 'trades-v1', isTrade),
      },
      revision: target.getItem(DATA_REVISION_KEY),
    },
  }), storage, lock)
}

/** Keep the snapshot revision even if another tab changed records during download setup. */
export function recordBackupRequest(snapshot: BackupSnapshot, requestedAt = new Date().toISOString(), storage?: Storage, lock?: StorageLock) {
  return mutateStorage(() => ({
    entries: { [BACKUP_REQUEST_KEY]: { requestedAt, revision: snapshot.revision } },
    value: true,
  }), storage, lock)
}
