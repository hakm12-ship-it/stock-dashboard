/**
 * 추가 매수 계산 — 물타기·불타기 후 평단과 손익이 어떻게 되는지.
 *
 * 예측이 아니라 산수다. 가격이 얼마가 될지는 아무도 모르고, 여기서는
 * "그 가격이 되면 이렇게 된다"만 계산한다.
 */

export interface Position {
  qty: number
  avg: number
}

export interface PL {
  cost: number
  value: number
  pl: number
  pct: number
}

/** 추가 매수 후의 수량·평단 (가중평균). */
export function afterBuy(pos: Position, addQty: number, price: number): Position {
  const qty = pos.qty + addQty
  if (qty <= 0) return { qty: 0, avg: 0 }
  return { qty, avg: (pos.qty * pos.avg + addQty * price) / qty }
}

/** 주어진 가격에서의 평가손익. */
export function plAt(pos: Position, price: number): PL {
  const cost = pos.qty * pos.avg
  const value = pos.qty * price
  const pl = value - cost
  return { cost, value, pl, pct: cost ? (pl / cost) * 100 : 0 }
}

/**
 * 본전까지 필요한 상승률(%). 이미 평단 위면 음수(그만큼 여유가 있다는 뜻).
 * 현재가가 0이면 계산이 불가능하므로 null.
 */
export function toBreakEven(pos: Position, price: number): number | null {
  if (!price) return null
  return (pos.avg / price - 1) * 100
}

export interface ScenarioRow {
  /** 현재가 대비 변화율(%) */
  movePct: number
  price: number
  before: PL
  after: PL
}

/**
 * 현재가가 ±N% 움직였을 때 추가 매수 전/후 손익을 나란히 본다.
 *
 * 두 값을 같이 보여주는 게 핵심이다. 물타기는 평단과 손익률을 낮춰 주지만
 * 투입 원금이 늘어난 만큼 **손실 금액은 커진다** — 한쪽만 보면 그게 안 보인다.
 */
export function scenarios(
  before: Position,
  after: Position,
  price: number,
  moves: number[],
): ScenarioRow[] {
  return moves.map((movePct) => {
    const p = price * (1 + movePct / 100)
    return { movePct, price: p, before: plAt(before, p), after: plAt(after, p) }
  })
}

/** 금액으로 살 수 있는 수량. 국내 주식은 소수점 매수가 안 되므로 버린다. */
export function qtyForAmount(amount: number, price: number, whole: boolean): number {
  if (!price || amount <= 0) return 0
  const q = amount / price
  return whole ? Math.floor(q) : Math.round(q * 1e6) / 1e6
}

export const DEFAULT_MOVES = [-30, -20, -10, 0, 10, 20, 30]
