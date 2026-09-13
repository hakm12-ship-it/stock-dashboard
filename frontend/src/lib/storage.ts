/** Persist first. Roll back earlier keys if a multi-list restore cannot finish. */
export function persist(entries: Record<string, unknown>, storage?: Storage): boolean {
  const previous = new Map<string, string | null>()
  try {
    storage ??= localStorage
    for (const key of Object.keys(entries)) previous.set(key, storage.getItem(key))
    for (const [key, value] of Object.entries(entries)) storage.setItem(key, JSON.stringify(value))
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
