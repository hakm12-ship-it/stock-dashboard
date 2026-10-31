import assert from 'node:assert/strict'
import test from 'node:test'
import { marketStatus } from './market.ts'
import { KR_HOLIDAYS } from './marketSchedule.ts'

test('KR holidays include election, restored holiday and year end', () => {
  for (const day of ['2026-05-01', '2026-06-03', '2026-07-17', '2026-10-05', '2026-12-31']) {
    const state = marketStatus('KR', new Date(`${day}T10:00:00+09:00`))
    assert.equal(state.open, false, day)
    assert.equal(state.label, '휴장', day)
  }
  assert.equal(marketStatus('KR', new Date('2026-09-28T10:00:00+09:00')).open, true)
})
test('KR 2027 calendar covers holidays, substitutes, year end and special hours', () => {
  const closed = {
    '2027-01-01': '신정', '2027-02-09': '설날 대체휴일', '2027-05-03': '노동절 대체휴일',
    '2027-07-19': '제헌절 대체휴일', '2027-09-15': '추석', '2027-12-27': '성탄절 대체휴일', '2027-12-31': '연말 휴장',
  }
  for (const [day, name] of Object.entries(closed)) {
    const state = marketStatus('KR', new Date(`${day}T10:00:00+09:00`))
    assert.deepEqual([state.open, state.label, state.detail], [false, '휴장', name], day)
  }
  for (const day of ['2027-01-05', '2027-12-30']) {
    const state = marketStatus('KR', new Date(`${day}T10:00:00+09:00`))
    assert.deepEqual([state.open, state.label, state.uncertain], [true, '장중', undefined], day)
  }
  for (const day of ['2027-01-04', '2027-11-18']) {
    const state = marketStatus('KR', new Date(`${day}T10:30:00+09:00`))
    assert.deepEqual([state.open, state.label, state.uncertain], [false, '거래시간 확인 필요', true], day)
  }
})
test('KR 2027 closures match the KRX lookup and 2027 월력요항 exactly', () => {
  const krx2027 = ['2027-01-01', '2027-02-08', '2027-02-09', '2027-03-01', '2027-05-03', '2027-05-05', '2027-05-13',
    '2027-07-19', '2027-08-16', '2027-09-14', '2027-09-15', '2027-09-16', '2027-10-04', '2027-10-11', '2027-12-27', '2027-12-31']
  assert.deepEqual(Object.keys(KR_HOLIDAYS).filter((day) => day.startsWith('2027-')).sort(), krx2027)
})
test('KR session includes opening and excludes closing minute', () => {
  assert.equal(marketStatus('KR', new Date('2026-10-06T08:59:59+09:00')).open, false)
  assert.equal(marketStatus('KR', new Date('2026-10-06T09:00:00+09:00')).open, true)
  assert.equal(marketStatus('KR', new Date('2026-10-06T15:30:00+09:00')).open, false)
})
test('US early closes at 13:00 ET and observes July 3 holiday', () => {
  assert.equal(marketStatus('US', new Date('2026-11-27T17:59:59Z')).open, true)
  assert.equal(marketStatus('US', new Date('2026-11-27T18:00:00Z')).label, '조기마감')
  assert.equal(marketStatus('US', new Date('2026-11-26T16:00:00Z')).open, false)
  assert.equal(marketStatus('US', new Date('2026-07-02T18:00:00Z')).open, true)
  assert.equal(marketStatus('US', new Date('2026-07-03T15:00:00Z')).open, false)
})
test('US follows DST and Friday when already Saturday in Korea', () => {
  assert.equal(marketStatus('US', new Date('2026-03-06T14:00:00Z')).open, false)
  assert.equal(marketStatus('US', new Date('2026-03-09T13:30:00Z')).open, true)
  assert.equal(marketStatus('US', new Date('2026-10-03T01:00:00+09:00')).open, true)
  assert.equal(marketStatus('US', new Date('2027-12-31T15:00:00Z')).open, true)
  assert.equal(marketStatus('US', new Date('2028-07-03T17:00:00Z')).label, '조기마감')
})
test('unknown schedules and special hours never claim an open session', () => {
  assert.equal(marketStatus('KR', new Date('2028-01-03T10:00:00+09:00')).label, '거래일 확인 필요')
  assert.equal(marketStatus('KR', new Date('2026-11-19T09:30:00+09:00')).open, false)
  assert.equal(marketStatus('US', new Date('2030-01-02T15:00:00Z')).open, false)
  assert.equal(marketStatus('KR', new Date('invalid')).open, false)
})
