/**
 * node --test src/lib/averaging.test.ts  (frontend 디렉터리에서)
 *
 * Node 24가 TypeScript를 그대로 실행하므로 테스트 러너를 따로 안 깐다.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { afterBuy, plAt, qtyForAmount, scenarios, toBreakEven } from './averaging.ts'

test('물타기하면 평단이 내려간다', () => {
  // 10주를 10,000원에 샀는데 5,000원으로 반토막. 10주를 더 산다.
  const after = afterBuy({ qty: 10, avg: 10000 }, 10, 5000)
  assert.equal(after.qty, 20)
  assert.equal(after.avg, 7500)
})

test('불타기하면 평단이 올라간다', () => {
  const after = afterBuy({ qty: 10, avg: 10000 }, 10, 15000)
  assert.equal(after.avg, 12500)
})

test('추가 수량이 0이면 그대로', () => {
  const after = afterBuy({ qty: 10, avg: 10000 }, 0, 5000)
  assert.deepEqual(after, { qty: 10, avg: 10000 })
})

test('보유가 없으면 추가 매수가 곧 평단', () => {
  assert.deepEqual(afterBuy({ qty: 0, avg: 0 }, 5, 8000), { qty: 5, avg: 8000 })
})

test('평가손익 — 원금·평가액·손익·손익률', () => {
  const pl = plAt({ qty: 10, avg: 10000 }, 5000)
  assert.equal(pl.cost, 100000)
  assert.equal(pl.value, 50000)
  assert.equal(pl.pl, -50000)
  assert.equal(pl.pct, -50)
})

test('본전까지 필요한 상승률', () => {
  // 평단 7,500원, 현재가 5,000원 -> 50% 올라야 본전
  assert.equal(toBreakEven({ qty: 20, avg: 7500 }, 5000), 50)
  // 이미 평단 위면 음수
  assert.equal(toBreakEven({ qty: 10, avg: 5000 }, 10000), -50)
  assert.equal(toBreakEven({ qty: 10, avg: 5000 }, 0), null)
})

test('물타기는 손익률을 낮추지만 손실 금액은 키운다', () => {
  // 이게 이 화면의 핵심. 한쪽만 보면 물타기가 늘 이득처럼 보인다.
  const before = { qty: 10, avg: 10000 }
  const after = afterBuy(before, 10, 5000) // 평단 7,500
  const [row] = scenarios(before, after, 5000, [0])

  assert.equal(row.price, 5000)
  assert.equal(row.before.pct, -50)
  assert.ok(row.after.pct > row.before.pct, '손익률은 개선돼야 한다')
  assert.equal(row.after.pct, -33.33333333333333)

  assert.equal(row.before.pl, -50000)
  assert.equal(row.after.pl, -50000) // 방금 산 몫은 아직 손익 0
  // 여기서 10% 더 빠지면 손실 금액 차이가 드러난다
  const [down] = scenarios(before, after, 5000, [-10])
  assert.equal(down.before.pl, -55000)
  assert.equal(down.after.pl, -60000)
  assert.ok(down.after.pl < down.before.pl, '투입이 늘었으니 손실 금액은 더 커진다')
})

test('시나리오는 요청한 변화율만큼 가격을 옮긴다', () => {
  const rows = scenarios({ qty: 1, avg: 100 }, { qty: 2, avg: 90 }, 100, [-20, 0, 20])
  assert.deepEqual(rows.map((r) => r.price), [80, 100, 120])
  assert.deepEqual(rows.map((r) => r.movePct), [-20, 0, 20])
})

test('금액으로 수량 계산 — 국내는 정수만', () => {
  assert.equal(qtyForAmount(1_000_000, 33_000, true), 30) // 30.3주 -> 30주
  assert.equal(qtyForAmount(1000, 33_000, true), 0) // 한 주도 못 산다
  assert.equal(qtyForAmount(1000, 400, false), 2.5) // 해외는 소수점 허용
  assert.equal(qtyForAmount(0, 100, true), 0)
  assert.equal(qtyForAmount(1000, 0, true), 0) // 가격 0이면 나눗셈 불가
})
