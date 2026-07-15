import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { TICKERS, type FocusTicker } from './data/tickers'
import type { Period } from './lib/api'
import IndexStrip from './components/IndexStrip'
import TickerSwitcher from './components/TickerSwitcher'
import StockHeader from './components/StockHeader'
import Week52Bar from './components/Week52Bar'
import BottomNav, { type TabKey } from './components/BottomNav'
import HomeView from './views/HomeView'
import SignalView from './views/SignalView'
import TechnicalView from './views/TechnicalView'
import FundamentalView from './views/FundamentalView'
import NewsView from './views/NewsView'
import Onboarding from './components/Onboarding'
import SearchSheet from './components/SearchSheet'
import HoldingsSheet from './components/HoldingsSheet'
import ComparisonSheet from './components/ComparisonSheet'
import { loadCustom, saveCustom } from './lib/customTickers'
import { loadHoldings, saveHoldings, type Holding } from './lib/holdings'
import { marketStatus } from './lib/market'

export default function App() {
  const [t, setT] = useState<FocusTicker>(TICKERS[0])
  const [period, setPeriod] = useState<Period>('3m')
  const [tab, setTab] = useState<TabKey>('home')
  const [updatedAt, setUpdatedAt] = useState<Date>(() => new Date())
  const [custom, setCustom] = useState<FocusTicker[]>(loadCustom)
  const [searchOpen, setSearchOpen] = useState(false)
  const [holdings, setHoldings] = useState<Holding[]>(loadHoldings)
  const [holdingsOpen, setHoldingsOpen] = useState(false)
  const [comparisonOpen, setComparisonOpen] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('theme') as 'dark' | 'light') || 'dark',
  )
  const qc = useQueryClient()

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }, [theme])

  // 장중이면 1분마다 자동 새로고침 (화면이 보일 때만)
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (marketStatus('KR').open || marketStatus('US').open) {
        qc.invalidateQueries()
        setUpdatedAt(new Date())
      }
    }, 60_000)
    return () => clearInterval(id)
  }, [qc])

  const all = [...TICKERS, ...custom]

  const refresh = () => {
    qc.invalidateQueries()
    setUpdatedAt(new Date())
  }
  const addTicker = (tk: FocusTicker) => {
    if (all.some((x) => x.ticker === tk.ticker && x.market === tk.market)) return
    const next = [...custom, tk]
    setCustom(next)
    saveCustom(next)
  }
  const removeTicker = (tk: FocusTicker) => {
    const next = custom.filter((x) => !(x.ticker === tk.ticker && x.market === tk.market))
    setCustom(next)
    saveCustom(next)
    if (t.ticker === tk.ticker && t.market === tk.market) setT(TICKERS[0])
  }
  const saveHolding = (h: Holding) => {
    const next = [...holdings.filter((x) => !(x.ticker === h.ticker && x.market === h.market)), h]
    setHoldings(next)
    saveHoldings(next)
  }
  const removeHolding = (h: Holding) => {
    const next = holdings.filter((x) => !(x.ticker === h.ticker && x.market === h.market))
    setHoldings(next)
    saveHoldings(next)
  }
  const importData = (d: { holdings?: Holding[]; customTickers?: FocusTicker[] }) => {
    if (Array.isArray(d.holdings)) {
      setHoldings(d.holdings)
      saveHoldings(d.holdings)
    }
    if (Array.isArray(d.customTickers)) {
      setCustom(d.customTickers)
      saveCustom(d.customTickers)
    }
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-app px-3 pt-safe pb-28 space-y-3">
        {/* 브랜드 + 새로고침 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">📈</span>
            <span className="text-base font-bold tracking-tight">스톡 인사이트</span>
            <span className="font-mono text-[0.55rem] text-accent border border-accent/40 rounded px-1.5 py-0.5 tracking-[0.1em]">
              BETA
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="text-base leading-none active:opacity-60"
              aria-label="다크/화이트 전환"
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <button
              onClick={refresh}
              className="flex items-center gap-1.5 font-mono text-[0.66rem] text-muted active:text-text"
            >
              <span className="text-sm leading-none">↻</span>
              <span>
                {updatedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </button>
          </div>
        </div>

        <div key={`${tab}-${t.ticker}`} className="fade-in space-y-3">
          {tab === 'home' ? (
            <HomeView
              tickers={all}
              holdings={holdings}
              light={theme === 'light'}
              onSelect={(tk) => {
                setT(tk)
                setTab('signal')
              }}
              onAddClick={() => setSearchOpen(true)}
              onAddTicker={addTicker}
              onManageHoldings={() => setHoldingsOpen(true)}
              onCompare={() => setComparisonOpen(true)}
            />
          ) : (
            <>
              <IndexStrip />
              <TickerSwitcher tickers={all} selected={t} onSelect={setT} />
              <StockHeader t={t} period={period} />
              <Week52Bar t={t} />
              <div className="pt-1">
                {tab === 'signal' && <SignalView t={t} />}
                {tab === 'tech' && (
                <TechnicalView t={t} period={period} setPeriod={setPeriod} light={theme === 'light'} />
              )}
                {tab === 'fund' && <FundamentalView t={t} />}
                {tab === 'news' && <NewsView t={t} tickers={all} />}
              </div>
            </>
          )}
        </div>

        <p className="text-[0.6rem] text-muted text-center pt-3 leading-relaxed">
          시세는 실시간이 아닌 지연 데이터입니다 · 우측 상단 ↻ 로 새로고침하세요
        </p>
      </div>

      <BottomNav active={tab} onChange={setTab} />

      {searchOpen && (
        <SearchSheet
          existing={all}
          custom={custom}
          onAdd={addTicker}
          onRemove={removeTicker}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {holdingsOpen && (
        <HoldingsSheet
          holdings={holdings}
          custom={custom}
          tickers={all}
          onSave={saveHolding}
          onRemove={removeHolding}
          onImport={importData}
          onClose={() => setHoldingsOpen(false)}
        />
      )}

      {comparisonOpen && (
        <ComparisonSheet tickers={all} light={theme === 'light'} onClose={() => setComparisonOpen(false)} />
      )}

      <Onboarding />
    </div>
  )
}
