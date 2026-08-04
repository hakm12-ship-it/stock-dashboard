import type { FocusTicker } from '../data/tickers'
import { marketStatus } from './market'

/** 야간(perp) 시세를 제공하는 종목 — 백엔드 data/hyperliquid.py의 TICKER_TO_PERP와 맞춰둘 것. */
const NIGHT_PRICE_TICKERS = new Set(['005930', '000660'])

export function hasNightPrice(t: FocusTicker): boolean {
  return t.market === 'KR' && NIGHT_PRICE_TICKERS.has(t.ticker)
}

/** 장중이면 '실시간', 장마감이면 '야간' — 같은 perp 시세라도 의미가 다르다. */
export function nightLabel(t: FocusTicker): string {
  return marketStatus(t.market).open ? '🌐 실시간' : '🌙 야간'
}

/** 기초자산 perp로 추정가를 합성할 수 있는 종목 — 백엔드 data/synthetic.py와 맞출 것 */
const SYNTH_TICKERS = new Set(['KORU', '0193T0'])

export function hasSynthPrice(t: FocusTicker): boolean {
  return SYNTH_TICKERS.has(t.ticker)
}

/** 실제 시세가 도는 정규장에는 추정가를 보여줄 이유가 없다. */
export function showSynthPrice(t: FocusTicker): boolean {
  return hasSynthPrice(t) && !marketStatus(t.market).open
}
