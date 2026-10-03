import assert from 'node:assert/strict'
import test from 'node:test'
import { CHART_PREFERENCES_KEY, DEFAULT_CHART_PREFERENCES, chartPeriod, loadChartPreferences, saveChartPreferences } from './chartPreferences.ts'

test('chart preferences survive a new view and invalid fields use safe defaults', () => {
  const data = new Map<string, string>()
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } } as Storage
  assert.deepEqual(loadChartPreferences(storage), DEFAULT_CHART_PREFERENCES)
  const chosen = { timeframe: 'W' as const, showMA: false, showBB: true, showSR: false }
  assert.equal(saveChartPreferences(chosen, storage), true)
  assert.deepEqual(loadChartPreferences(storage), chosen)
  data.set(CHART_PREFERENCES_KEY, JSON.stringify({ timeframe: 'invalid', showMA: false, showBB: 'yes', showSR: 0 }))
  assert.deepEqual(loadChartPreferences(storage), { ...DEFAULT_CHART_PREFERENCES, showMA: false })
  data.set(CHART_PREFERENCES_KEY, 'broken')
  assert.deepEqual(loadChartPreferences(storage), DEFAULT_CHART_PREFERENCES)
})

test('weekly restoration uses at least six months without changing a longer period', () => {
  assert.equal(chartPeriod('1m', 'W'), '6m')
  assert.equal(chartPeriod('3m', 'W'), '6m')
  assert.equal(chartPeriod('1y', 'W'), '1y')
  assert.equal(chartPeriod('1m', 'D'), '1m')
})

test('unavailable preference storage does not crash the chart', () => {
  const storage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('quota') } } as unknown as Storage
  assert.deepEqual(loadChartPreferences(storage), DEFAULT_CHART_PREFERENCES)
  assert.equal(saveChartPreferences(DEFAULT_CHART_PREFERENCES, storage), false)
})
