import { useEffect, useState } from 'react'
import { TICKERS, type FocusTicker } from '../data/tickers'
import { loadCustom } from './customTickers'
export type TabKey = 'home' | 'signal' | 'tech' | 'fund' | 'news' | 'calendar'
export const TAB_LABELS: Record<TabKey, string> = {
  home: '관심종목',
  signal: '종합 분석',
  tech: '차트',
  fund: '기업 가치',
  news: '관련 뉴스',
  calendar: '경제 캘린더',
}
function readRoute(): { tab: TabKey; ticker: FocusTicker } {
  const p = new URLSearchParams(location.hash.slice(1))
  const key = location.pathname.replace(/\/$/, '') === '/calendar' ? 'calendar' : p.get('tab') ?? 'home'
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
    let currentTab = readRoute().tab
    let currentTicker = readRoute().ticker
    let currentLocation = location.pathname + location.hash
    let homeScroll = 0
    const previousRestoration = history.scrollRestoration
    history.scrollRestoration = 'manual'
    let frame = 0
    const sync = () => {
      const nextLocation = location.pathname + location.hash
      // 시트의 같은 주소 history 항목이나 중복 popstate/hashchange는 화면 이동이 아니다.
      if (nextLocation === currentLocation) return
      currentLocation = nextLocation
      if (currentTab === 'home') homeScroll = window.scrollY
      const next = readRoute()
      if (next.tab === 'calendar') next.ticker = currentTicker
      else currentTicker = next.ticker
      currentTab = next.tab
      setRoute(next)
      // 누른 버튼이 새 화면으로 바뀌며 사라지면 초점이 body로 떨어진다. 새 화면 제목으로 옮긴다.
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        window.scrollTo(0, next.tab === 'home' ? homeScroll : 0)
        const active = document.activeElement
        if (next.tab !== 'home' || !active || active === document.body || !active.isConnected) {
          document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true })
        }
      })
    }
    window.addEventListener('hashchange', sync)
    window.addEventListener('popstate', sync)
    window.addEventListener('app:navigate', sync)
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('popstate', sync)
      window.removeEventListener('app:navigate', sync)
      cancelAnimationFrame(frame)
      history.scrollRestoration = previousRestoration
    }
  }, [])
  useEffect(() => {
    document.title =
      route.tab === 'home'
        ? '스톡 인사이트 · 한국·미국 주식 리서치'
        : route.tab === 'calendar'
          ? '경제 캘린더 · 금리·경제지표·빅테크 실적 | 스톡 인사이트'
        : `${route.ticker.short} ${TAB_LABELS[route.tab]} · 스톡 인사이트`
    const calendar = route.tab === 'calendar'
    const description = calendar
      ? '미국 FOMC·한국은행 금리 결정, CPI·고용·GDP·PCE와 주요 빅테크 실적 발표 일정을 출처와 함께 확인하세요. 확정·예상 일정과 한국시간을 구분합니다.'
      : '한국·미국 관심종목의 시세, 차트, 기업 가치와 뉴스를 한곳에서 살펴보세요. 보유종목 손익과 매매 기록을 관리하는 개인 리서치 도구, 스톡 인사이트.'
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    const origin = canonical ? new URL(canonical.href).origin : location.origin
    const url = `${origin}${calendar ? '/calendar' : '/'}`
    if (canonical) canonical.href = url
    document.querySelector('meta[name="description"]')?.setAttribute('content', description)
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', description)
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', document.title)
    document.querySelector('meta[property="og:url"]')?.setAttribute('content', url)
  }, [route])
  const navigate = (tab: TabKey, ticker = route.ticker) => {
    const hash = new URLSearchParams({
      tab,
      ticker: ticker.ticker,
      market: ticker.market,
      name: ticker.name,
      kind: ticker.kind,
    }).toString()
    const url = tab === 'calendar' ? '/calendar' : `/#${hash}`
    if (location.pathname + location.hash === url) return
    history.pushState({}, '', url)
    window.dispatchEvent(new Event('app:navigate'))
  }
  return { t: route.ticker, tab: route.tab, navigate }
}
