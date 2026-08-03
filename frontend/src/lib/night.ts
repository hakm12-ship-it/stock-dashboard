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
