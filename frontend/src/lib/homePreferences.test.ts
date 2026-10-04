import assert from 'node:assert/strict'
import test from 'node:test'
import { HOME_PREFERENCES_KEY, loadHomePreferences, saveHomePreferences } from './homePreferences.ts'

test('home filter, sort and period restore without persisting personal search terms', () => {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } as unknown as Storage
  assert.equal(saveHomePreferences({ filter: 'US', sort: 'losers', sparkPeriod: '6m', query: 'personal-search' }, storage), true)
  assert.deepEqual(loadHomePreferences(storage), { filter: 'US', sort: 'losers', sparkPeriod: '6m', query: '' })
  assert.equal(values.get(HOME_PREFERENCES_KEY)?.includes('personal-search'), false)
})
test('corrupt, unknown-version and invalid home settings use safe defaults', () => {
  for (const raw of ['{', '{"v":9,"filter":"US"}', '{"v":1,"filter":"evil","sort":null,"sparkPeriod":"1y"}']) {
    assert.deepEqual(loadHomePreferences({ getItem: () => raw } as unknown as Storage), { filter: 'all', sort: 'default', sparkPeriod: '1m', query: '' })
  }
  const blocked = { getItem: () => { throw Error('blocked') }, setItem: () => { throw Error('blocked') } } as unknown as Storage
  assert.equal(loadHomePreferences(blocked).filter, 'all')
  assert.equal(saveHomePreferences(loadHomePreferences(blocked), blocked), false)
})
