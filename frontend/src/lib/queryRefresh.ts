import type { QueryClient } from '@tanstack/react-query'

/** TanStack resolves invalidateQueries even when a fetch fails; inspect every attempted query. */
export async function refreshActiveQueries(client: QueryClient): Promise<boolean> {
  const active = new Set(client.getQueryCache().getAll().filter((query) => query.isActive()))
  await client.invalidateQueries({ predicate: (query) => active.has(query) })
  return [...active].every((query) => query.state.status === 'success' && query.state.error == null)
}
