import { isTicker } from './validation.ts'
import { persist } from './storage.ts'
import type { FocusTicker } from '../data/tickers.ts'

const KEY = 'customTickers'

export function loadCustom(): FocusTicker[] {
  try {
    const raw = localStorage.getItem(KEY)
    const value: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(value) ? value.filter(isTicker) : []
  } catch {
    return []
  }
}

export function saveCustom(list: FocusTicker[]): boolean {
  return persist({ customTickers: list })
}
