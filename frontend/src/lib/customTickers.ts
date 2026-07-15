import type { FocusTicker } from '../data/tickers'

const KEY = 'customTickers'

export function loadCustom(): FocusTicker[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as FocusTicker[]) : []
  } catch {
    return []
  }
}

export function saveCustom(list: FocusTicker[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* 저장 실패는 무시 */
  }
}
