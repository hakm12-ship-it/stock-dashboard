import { marketStatus } from './market.ts'

const tickerKeys = new Set(['prices', 'ind', 'signal', 'forecast'])
function tickerMarket(ticker: string): 'KR' | 'US' {
  return /^\d{4}[A-Z0-9]{2}$/.test(ticker) || ['KS11', 'KQ11', '^KS11', '^KQ11'].includes(ticker) ? 'KR' : 'US'
}

export function shouldRefreshMarketQuery(key: readonly unknown[], now = new Date()): boolean {
  const kind = String(key[0])
  if (kind === 'marketTop' && key[2] === 'CRYPTO') return true
  const kr = marketStatus('KR', now).open
  const us = marketStatus('US', now).open
  if (!kr && !us) return false
  const forTicker = (ticker: string) => tickerMarket(ticker) === 'KR' ? kr : us
  if (tickerKeys.has(kind)) return forTicker(String(key[1]))
  if (kind === 'watchlist') return String(key[1]).split(',').some(forTicker)
  if (kind === 'index') return ['KOSPI', 'KOSDAQ'].includes(String(key[1])) ? kr : us
  if (kind === 'marketTop') return key[2] === 'NASDAQ' ? us : kr
  if (kind === 'groupStocks') return kr
  return kind === 'fx' || kind === 'macro'
}
