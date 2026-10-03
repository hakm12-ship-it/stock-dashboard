import test from 'node:test'
import assert from 'node:assert/strict'
import { briefingDate, briefingTimestamp, currentBriefing, isFutureBriefing, shiftBriefingDate } from './publicBriefing.ts'

test('briefing day and slot follow Korean time across UTC midnight', () => {
  assert.equal(briefingDate(new Date('2026-10-04T16:00:00Z')), '2026-10-05')
  assert.deepEqual(currentBriefing(new Date('2026-10-04T22:00:00Z')), { date: '2026-10-05', slot: 'morning' })
  assert.equal(currentBriefing(new Date('2026-10-05T03:00:00Z')).slot, 'noon')
  assert.equal(currentBriefing(new Date('2026-10-05T09:00:00Z')).slot, 'evening')
})

test('before morning does not silently select yesterday evening', () => {
  assert.deepEqual(currentBriefing(new Date('2026-10-04T21:59:00Z')), { date: '2026-10-05', slot: 'morning' })
})

test('future slots are disabled until their Korean-time boundary', () => {
  const beforeNoon = new Date('2026-10-05T02:59:59Z')
  assert.equal(isFutureBriefing('2026-10-05', 'morning', beforeNoon), false)
  assert.equal(isFutureBriefing('2026-10-05', 'noon', beforeNoon), true)
  assert.equal(isFutureBriefing('2026-10-05', 'evening', beforeNoon), true)
  assert.equal(isFutureBriefing('2026-10-04', 'evening', beforeNoon), false)
  assert.equal(isFutureBriefing('2026-10-05', 'noon', new Date('2026-10-05T03:00:00Z')), false)
  assert.equal(isFutureBriefing('2026-10-05', 'morning', new Date('2026-10-04T21:59:00Z')), true)
})

test('archive date range crosses month boundaries and invalid times are explicit', () => {
  assert.equal(shiftBriefingDate('2026-10-04', -6), '2026-09-28')
  assert.equal(briefingTimestamp(null), '시각 미확인')
  assert.equal(briefingTimestamp('not-a-date'), '시각 미확인')
  assert.match(briefingTimestamp('2026-10-04T22:00:00Z'), /07:00/)
})
