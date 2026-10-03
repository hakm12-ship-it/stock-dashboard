import assert from 'node:assert/strict'
import test from 'node:test'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { refreshActiveQueries } from './queryRefresh.ts'

test('refresh reports failure even when cached prices remain, and succeeds after recovery', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  let failed = true
  const observer = new QueryObserver(client, {
    queryKey: ['prices', 'NVDA'], initialData: [{ close: 100 }], staleTime: Infinity,
    queryFn: async () => { if (failed) throw new Error('offline'); return [{ close: 120 }] },
  })
  const unsubscribe = observer.subscribe(() => {})
  assert.equal(await refreshActiveQueries(client), false)
  assert.deepEqual(client.getQueryData(['prices', 'NVDA']), [{ close: 100 }])
  failed = false
  assert.equal(await refreshActiveQueries(client), true)
  assert.deepEqual(client.getQueryData(['prices', 'NVDA']), [{ close: 120 }])
  unsubscribe()
  client.clear()
})
