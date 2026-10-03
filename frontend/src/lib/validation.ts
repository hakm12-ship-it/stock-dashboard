import type { Holding } from './holdings.ts'
import type { Trade } from './trades.ts'
import type { FocusTicker } from '../data/tickers.ts'
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= 200
export const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
const identity = (v: Record<string, unknown>) =>
  text(v.ticker) &&
  /^[A-Za-z0-9.^=-]{1,24}$/.test(v.ticker as string) &&
  text(v.name) &&
  (v.market === 'KR' || v.market === 'US')
export const isHolding = (v: unknown): v is Holding =>
  record(v) &&
  identity(v) &&
  (v.kind === 'stock' || v.kind === 'etf') &&
  positive(v.qty) &&
  positive(v.avg) &&
  positive(v.qty * v.avg)
export const isTicker = (v: unknown): v is FocusTicker =>
  record(v) &&
  identity(v) &&
  text(v.short) &&
  ['stock', 'etf', 'index'].includes(String(v.kind)) &&
  (v.indexName === undefined || ['KOSPI', 'NASDAQ'].includes(String(v.indexName))) &&
  (v.lev === undefined || text(v.lev))
export const validDate = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v
export const isTrade = (v: unknown): v is Trade =>
  record(v) &&
  identity(v) &&
  text(v.id) &&
  validDate(v.date) &&
  (v.side === 'buy' || v.side === 'sell') &&
  positive(v.qty) &&
  positive(v.price) &&
  positive(v.qty * v.price) &&
  (v.sequence === undefined || (Number.isSafeInteger(v.sequence) && positive(v.sequence))) &&
  (v.memo === undefined || (typeof v.memo === 'string' && v.memo.length <= 2000))
export interface Backup {
  v?: number
  holdings?: Holding[]
  customTickers?: FocusTicker[]
  trades?: Trade[]
}
function list<T>(v: unknown, guard: (x: unknown) => x is T, key: (x: T) => string): v is T[] {
  return Array.isArray(v) && v.length <= 10000 && v.every(guard) && new Set(v.map(key)).size === v.length
}
export function parseBackup(raw: string): Backup {
  if (raw.length > 5_000_000) throw new Error('백업 파일이 너무 큽니다 (최대 5MB).')
  const d: unknown = JSON.parse(raw)
  if (!record(d) || (d.v !== undefined && d.v !== 1 && d.v !== 2))
    throw new Error('지원하지 않는 백업 형식입니다.')
  const key = (x: Holding | FocusTicker) => `${x.market}-${x.ticker}`
  if (d.holdings !== undefined && !list(d.holdings, isHolding, key))
    throw new Error('보유종목에 잘못된 값이나 중복 종목이 있습니다.')
  if (d.customTickers !== undefined && !list(d.customTickers, isTicker, key))
    throw new Error('관심종목의 형식이나 중복 여부를 확인해 주세요.')
  if (d.trades !== undefined && !list(d.trades, isTrade, (x) => x.id))
    throw new Error('매매 기록의 날짜·수량·가격을 확인해 주세요.')
  if (d.holdings === undefined && d.customTickers === undefined && d.trades === undefined)
    throw new Error('복원할 목록이 없습니다.')
  return {
    v: 2,
    holdings: d.holdings as Holding[] | undefined,
    customTickers: d.customTickers as FocusTicker[] | undefined,
    trades: d.trades as Trade[] | undefined,
  }
}

/** 사용자가 입력한 금액·수량을 숫자로 읽는다. 앱 곳곳에 보이는 형식(쉼표, 원, $)을 그대로 붙여 넣어도 된다. */
export const parseAmount = (s: string): number => {
  const cleaned = s.replace(/[,\s원$₩주]/g, '')
  return cleaned === '' ? NaN : Number(cleaned)
}
