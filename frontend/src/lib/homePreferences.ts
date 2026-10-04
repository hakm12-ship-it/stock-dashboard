export const HOME_PREFERENCES_KEY = 'home-preferences-v1'
export interface WatchlistPreferences {
  sort: 'default' | 'gainers' | 'losers'
  filter: 'all' | 'KR' | 'US' | 'held'
  query: string
  sparkPeriod: '1m' | '3m' | '6m'
}
const defaults: WatchlistPreferences = { sort: 'default', filter: 'all', query: '', sparkPeriod: '1m' }

export function loadHomePreferences(storage?: Storage): WatchlistPreferences {
  try {
    const value = JSON.parse((storage ?? localStorage).getItem(HOME_PREFERENCES_KEY) ?? 'null')
    if (!value || value.v !== 1) return { ...defaults }
    return {
      sort: ['default', 'gainers', 'losers'].includes(value.sort) ? value.sort : defaults.sort,
      filter: ['all', 'KR', 'US', 'held'].includes(value.filter) ? value.filter : defaults.filter,
      sparkPeriod: ['1m', '3m', '6m'].includes(value.sparkPeriod) ? value.sparkPeriod : defaults.sparkPeriod,
      query: '',
    }
  } catch { return { ...defaults } }
}

export function saveHomePreferences(value: WatchlistPreferences, storage?: Storage): boolean {
  try {
    (storage ?? localStorage).setItem(HOME_PREFERENCES_KEY, JSON.stringify({
      v: 1, sort: value.sort, filter: value.filter, sparkPeriod: value.sparkPeriod,
    }))
    return true
  } catch { return false }
}
