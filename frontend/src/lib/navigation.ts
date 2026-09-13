import { useEffect, useState } from 'react'
import { TICKERS, type FocusTicker } from '../data/tickers'
import { loadCustom } from './customTickers'
export type TabKey = 'home' | 'signal' | 'tech' | 'fund' | 'news'
export const TAB_LABELS: Record<TabKey, string> = {
  home: '관심종목',
  signal: '종합 분석',
  tech: '차트',
  fund: '기업 가치',
  news: '관련 뉴스',
}
function readRoute(): { tab: TabKey; ticker: FocusTicker } {
  const p = new URLSearchParams(location.hash.slice(1))
  const key = p.get('tab') ?? 'home'
  const tab = Object.hasOwn(TAB_LABELS, key) ? (key as TabKey) : 'home'
  const found = [...TICKERS, ...loadCustom()].find(
    (t) => t.ticker === p.get('ticker') && t.market === p.get('market'),
  )
  const market = p.get('market'),
    ticker = p.get('ticker'),
    name = p.get('name'),
    kind = p.get('kind')
  const shared: FocusTicker | undefined =
    ticker &&
    /^[A-Za-z0-9.^=-]{1,24}$/.test(ticker) &&
    name &&
    name.length <= 120 &&
    (market === 'KR' || market === 'US')
      ? { ticker, name, short: name, market, kind: kind === 'etf' ? 'etf' : 'stock' }
      : undefined
  return { tab, ticker: found ?? shared ?? TICKERS[0] }
}
export function useNavigation() {
  const [route, setRoute] = useState(readRoute)
  useEffect(() => {
    const sync = () => {
      setRoute(readRoute())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])
  useEffect(() => {
    document.title =
      route.tab === 'home'
        ? '스톡 인사이트 · 한국·미국 주식 리서치'
        : `${route.ticker.short} ${TAB_LABELS[route.tab]} · 스톡 인사이트`
  }, [route])
  const navigate = (tab: TabKey, ticker = route.ticker) => {
    location.hash = new URLSearchParams({
      tab,
      ticker: ticker.ticker,
      market: ticker.market,
      name: ticker.name,
      kind: ticker.kind,
    }).toString()
  }
  return { t: route.ticker, tab: route.tab, navigate }
}
