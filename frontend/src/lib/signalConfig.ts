// 신호 규칙 사용자 설정 (localStorage)

export interface SignalConfig {
  rsiLow: number
  rsiHigh: number
  w: { rsi: number; macd: number; ma20: number; cross: number; boll: number }
}

export const DEFAULT_SIGNAL_CONFIG: SignalConfig = {
  rsiLow: 30,
  rsiHigh: 70,
  w: { rsi: 1, macd: 1, ma20: 1, cross: 1, boll: 1 },
}

const KEY = 'signalConfig-v1'

export function loadSignalConfig(): SignalConfig {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_SIGNAL_CONFIG
    const d = JSON.parse(raw)
    return {
      rsiLow: d.rsiLow ?? 30,
      rsiHigh: d.rsiHigh ?? 70,
      w: { ...DEFAULT_SIGNAL_CONFIG.w, ...(d.w ?? {}) },
    }
  } catch {
    return DEFAULT_SIGNAL_CONFIG
  }
}

export function saveSignalConfig(c: SignalConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch {
    /* ignore */
  }
}

/** API 쿼리 파라미터로 변환 */
export const cfgParams = (c: SignalConfig): Record<string, number> => ({
  rsi_low: c.rsiLow,
  rsi_high: c.rsiHigh,
  w_rsi: c.w.rsi,
  w_macd: c.w.macd,
  w_ma20: c.w.ma20,
  w_cross: c.w.cross,
  w_boll: c.w.boll,
})

/** react-query 캐시 키용 문자열 */
export const cfgKey = (c: SignalConfig): string => JSON.stringify(cfgParams(c))

export const isDefaultConfig = (c: SignalConfig): boolean =>
  cfgKey(c) === cfgKey(DEFAULT_SIGNAL_CONFIG)
