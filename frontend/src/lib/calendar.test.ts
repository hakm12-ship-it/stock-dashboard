import test from 'node:test'
import assert from 'node:assert/strict'
import { koreanDate, shiftDate, shiftMonth, monthRange, monthDays, eventTime, sortedEvents, type CalendarEvent } from './calendar.ts'

test('한국 날짜는 UTC 자정이 아니라 한국 자정에 바뀐다', () => {
  assert.equal(koreanDate(new Date('2026-10-04T14:59:00Z')), '2026-10-04')
  assert.equal(koreanDate(new Date('2026-10-04T15:00:00Z')), '2026-10-05')
})

test('월 범위와 달력은 연말·윤년을 처리한다', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01')
  assert.equal(shiftMonth('2026-01', -1), '2025-12')
  assert.deepEqual(monthRange('2028-02'), { start: '2028-02-01', end: '2028-02-29' })
  assert.equal(monthDays('2028-02').filter(Boolean).length, 29)
  assert.equal(monthDays('2026-10')[4], '2026-10-01')
  assert.equal(monthDays('2026-10').length % 7, 0)
  assert.equal(shiftDate('2026-12-30', 6), '2027-01-05')
})

const event: CalendarEvent = { id: 'test', title: '실적 발표', category: 'earnings', country: 'US', startAt: '2026-10-04T20:00:00Z', date: '2026-10-05', timeStatus: 'confirmed', importance: 'high', source: '공식 출처', sourceUrl: 'https://example.com' }
test('발표 시각은 한국시간으로 표시하며 현지 날짜만 주어진 일정과 구분한다', () => {
  assert.equal(eventTime(event), '05:00 확정 · 한국시간')
  assert.equal(eventTime({ ...event, timeStatus: 'tentative' }), '05:00 예상 · 한국시간')
  assert.equal(eventTime({ ...event, startAt: null, timeStatus: 'date_only' }), '시간 미정 · 현지 날짜')
  assert.equal(eventTime({ ...event, startAt: null, timeStatus: 'tentative' }), '예상 · 시간 미정 · 현지 날짜')
})

test('일정은 날짜와 실제 발표시각으로 정렬하고 시간 미정은 마지막에 둔다', () => {
  const events = [{ ...event, id: 'unknown', startAt: null }, { ...event, id: 'late', startAt: '2026-10-04T20:00:00Z' }, { ...event, id: 'early', startAt: '2026-10-05T01:00:00+09:00' }]
  assert.deepEqual(sortedEvents(events).map((item) => item.id), ['early', 'late', 'unknown'])
})
