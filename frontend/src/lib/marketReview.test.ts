import test from 'node:test'
import assert from 'node:assert/strict'
import { marketReview } from './marketReview.ts'
test('year-end review flags the missing next KR year and near-future special hours', () => {
  const result = marketReview(new Date('2026-10-04T00:00:00+09:00'))
  assert.ok(result.alerts.some((a) => a.id === 'KR-next'))
  assert.ok(result.alerts.some((a) => a.id === '2026-11-19'))
  assert.ok(!result.alerts.some((a) => a.id.startsWith('US-') || a.id === '2026-01-02'))
})
test('rollover reports unregistered current year and excludes past special hours', () => {
  const result = marketReview(new Date('2026-12-31T15:01:00Z'))
  assert.equal(result.today, '2027-01-01')
  assert.deepEqual(result.alerts.map((a) => a.id), ['KR-current'])
  assert.equal(marketReview(new Date('2026-05-01T00:00:00+09:00')).alerts.length, 0)
})
