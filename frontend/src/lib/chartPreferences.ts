export interface ChartPreferences {
  timeframe: 'D' | 'W'
  showMA: boolean
  showBB: boolean
  showSR: boolean
}

export const CHART_PREFERENCES_KEY = 'chart-preferences-v1'
export const DEFAULT_CHART_PREFERENCES: ChartPreferences = {
  timeframe: 'D', showMA: true, showBB: false, showSR: true,
}

export function loadChartPreferences(storage?: Storage): ChartPreferences {
  try {
    const value = JSON.parse((storage ?? localStorage).getItem(CHART_PREFERENCES_KEY) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_CHART_PREFERENCES }
    return {
      timeframe: value.timeframe === 'W' ? 'W' : 'D',
      showMA: typeof value.showMA === 'boolean' ? value.showMA : DEFAULT_CHART_PREFERENCES.showMA,
      showBB: typeof value.showBB === 'boolean' ? value.showBB : DEFAULT_CHART_PREFERENCES.showBB,
      showSR: typeof value.showSR === 'boolean' ? value.showSR : DEFAULT_CHART_PREFERENCES.showSR,
    }
  } catch { return { ...DEFAULT_CHART_PREFERENCES } }
}

export function saveChartPreferences(preferences: ChartPreferences, storage?: Storage): boolean {
  try {
    (storage ?? localStorage).setItem(CHART_PREFERENCES_KEY, JSON.stringify(preferences))
    return true
  } catch { return false }
}

export function chartPeriod(period: '1m' | '3m' | '6m' | '1y', timeframe: 'D' | 'W') {
  return timeframe === 'W' && (period === '1m' || period === '3m') ? '6m' : period
}
