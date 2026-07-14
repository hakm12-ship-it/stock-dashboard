import type { Market } from '../data/tickers'

export const fmtPrice = (v: number | null | undefined, market: Market): string => {
  if (v == null) return '—'
  return market === 'KR' ? `${Math.round(v).toLocaleString()}원` : `$${v.toFixed(2)}`
}

export const fmtNum = (v: number | null | undefined, d = 2): string =>
  v == null
    ? '—'
    : v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d })

export const fmtPct = (v: number | null | undefined): string =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

export const fmtCap = (v: number | null | undefined, market: Market): string => {
  if (v == null) return '—'
  if (market === 'US') {
    if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
    if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
    return `$${(v / 1e6).toFixed(0)}M`
  }
  const jo = v / 1e12
  return jo >= 1
    ? `${jo.toLocaleString(undefined, { maximumFractionDigits: 1 })}조`
    : `${Math.round(v / 1e8).toLocaleString()}억`
}

export const fmtEps = (v: number | null | undefined, market: Market): string => {
  if (v == null) return '—'
  return market === 'KR' ? `${Math.round(v).toLocaleString()}원` : `$${v.toFixed(2)}`
}

// 상승=빨강 / 하락=파랑 (KR 관례) 클래스
export const changeColor = (v: number): string => (v >= 0 ? 'text-up' : 'text-down')
export const changeSign = (v: number): string => (v >= 0 ? '▲' : '▼')
