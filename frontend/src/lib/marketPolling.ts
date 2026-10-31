import { marketStatus } from './market.ts'

const tickerKeys = new Set(['prices', 'ind', 'signal', 'forecast'])
function tickerMarket(ticker: string): 'KR' | 'US' {
  return /^\d{4}[A-Z0-9]{2}$/.test(ticker) || ['KS11', 'KQ11', '^KS11', '^KQ11'].includes(ticker) ? 'KR' : 'US'
}

// 마감 직전 값이 '종가'로 남지 않도록 정규장(조기마감 포함) 종료 후 30분까지 더 갱신한다.
// 30분 전에 장중이었는지를 함께 보므로 주말·휴장·미확인 일정에서는 그대로 멈춘다.
const CLOSE_GRACE_MS = 30 * 60 * 1000
function polling(market: 'KR' | 'US', now: Date): boolean {
  return marketStatus(market, now).open || marketStatus(market, new Date(now.getTime() - CLOSE_GRACE_MS)).open
}

export interface MarketPolling { kr: boolean; us: boolean }

function pollingAt(now: Date): MarketPolling {
  return { kr: polling('KR', now), us: polling('US', now) }
}

// 탭이 숨겨졌거나 기기가 잠들어 확인이 빈 동안 한 번이라도 갱신 대상이었던 시장.
// 그 사이 장이 열리고 닫혔으면 받아 둔 장전·장중 값이 '종가'로 남지 않게 한 번 새로 받는다.
// 갱신 구간(정규장+마감 후 30분)은 3시간 반이 넘으므로 15분 간격 표본으로 놓치지 않는다.
const SAMPLE_MS = 15 * 60 * 1000
const MAX_GAP_MS = 4 * 24 * 60 * 60 * 1000
export function marketsPolledSince(since: number, now = new Date()): MarketPolling {
  const out = pollingAt(now)
  const end = now.getTime()
  for (let t = Math.max(since, end - MAX_GAP_MS); t < end && !(out.kr && out.us); t += SAMPLE_MS) {
    const at = pollingAt(new Date(t))
    out.kr ||= at.kr
    out.us ||= at.us
  }
  return out
}

export function shouldRefreshMarketQuery(key: readonly unknown[], now = new Date()): boolean {
  return refreshMarketQuery(key, pollingAt(now))
}

export function refreshMarketQuery(key: readonly unknown[], { kr, us }: MarketPolling): boolean {
  const kind = String(key[0])
  if (kind === 'marketTop' && key[2] === 'CRYPTO') return true
  if (!kr && !us) return false
  const forTicker = (ticker: string) => tickerMarket(ticker) === 'KR' ? kr : us
  if (tickerKeys.has(kind)) return forTicker(String(key[1]))
  if (kind === 'watchlist') return String(key[1]).split(',').some(forTicker)
  if (kind === 'index') return ['KOSPI', 'KOSDAQ'].includes(String(key[1])) ? kr : us
  if (kind === 'marketTop') return key[2] === 'NASDAQ' ? us : kr
  if (kind === 'groupStocks') return kr
  return kind === 'fx' || kind === 'macro'
}
