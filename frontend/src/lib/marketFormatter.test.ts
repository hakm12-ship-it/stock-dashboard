import assert from 'node:assert/strict'
import test from 'node:test'
import { marketStatus } from './market.ts'

// 탭 복귀 때 marketsPolledSince가 며칠치를 15분 표본으로 훑으며 marketStatus를 수백 번 부른다.
// 호출마다 Intl.DateTimeFormat을 새로 만들면 메인 스레드가 멈추므로 시간대별로 하나만 만든다.
test('marketStatus builds at most one Intl formatter per timezone', (t) => {
  const ctor = t.mock.method(Intl, 'DateTimeFormat')
  const start = Date.parse('2026-11-02T00:00:00Z')
  for (let i = 0; i < 200; i++) {
    const at = new Date(start + i * 15 * 60 * 1000)
    marketStatus('KR', at)
    marketStatus('US', at)
  }
  assert.ok(ctor.mock.callCount() <= 2, `built ${ctor.mock.callCount()} formatters`)
})

test('cached formatters stay keyed by timezone when markets interleave', () => {
  const krMorning = new Date('2026-11-04T10:00:00+09:00') // 뉴욕은 11/3 20:00
  const usMorning = new Date('2026-11-04T10:00:00-05:00') // 서울은 11/5 00:00
  for (let i = 0; i < 3; i++) {
    assert.deepEqual([marketStatus('KR', krMorning).label, marketStatus('US', krMorning).label], ['장중', '장마감'])
    assert.deepEqual([marketStatus('US', usMorning).label, marketStatus('KR', usMorning).label], ['장중', '개장 전'])
  }
})
