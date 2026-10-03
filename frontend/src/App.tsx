import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { TICKERS, type FocusTicker } from './data/tickers'
import type { Period } from './lib/api'
import TickerSwitcher from './components/TickerSwitcher'
import StockHeader from './components/StockHeader'
import AverageBuyCard from './components/AverageBuyCard'
import Week52Bar from './components/Week52Bar'
import BottomNav from './components/BottomNav'
import HomeView, { type WatchlistPreferences } from './views/HomeView'
import SignalView from './views/SignalView'
import TechnicalView from './views/TechnicalView'
import FundamentalView from './views/FundamentalView'
import NewsView from './views/NewsView'
import CalendarView from './views/CalendarView'
import Icon from './components/Icon'
import { useNavigation, TAB_LABELS } from './lib/navigation'
import SearchSheet from './components/SearchSheet'
import HoldingsSheet from './components/HoldingsSheet'
import ComparisonSheet from './components/ComparisonSheet'
import { loadCustom, saveCustom } from './lib/customTickers'
import { loadHoldings, saveHoldings, type Holding } from './lib/holdings'
import { loadTrades, saveTrades, type Trade } from './lib/trades'
import TradeJournalSheet from './components/TradeJournalSheet'
import { persist } from './lib/storage'
import { parseBackup, type Backup } from './lib/validation'
import { marketStatus } from './lib/market'

const realtimeKeys = new Set(['prices', 'index', 'ind', 'signal', 'forecast', 'fx', 'macro', 'marketTop', 'groupStocks'])

export default function App() {
  const { t, tab, navigate } = useNavigation()
  const setT = (tk: FocusTicker) => navigate(tab, tk)
  const setTab = (next: typeof tab) => navigate(next)
  const [period, setPeriod] = useState<Period>('3m')
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [custom, setCustom] = useState<FocusTicker[]>(loadCustom)
  const [searchOpen, setSearchOpen] = useState(false)
  const [watchlistPreferences, setWatchlistPreferences] = useState<WatchlistPreferences>({
    sort: 'default',
    filter: 'all',
    query: '',
    sparkPeriod: '1m',
  })
  const [holdings, setHoldings] = useState<Holding[]>(loadHoldings)
  const [holdingsOpen, setHoldingsOpen] = useState(false)
  const [comparisonOpen, setComparisonOpen] = useState(false)
  const [trades, setTrades] = useState<Trade[]>(loadTrades)
  const [journalOpen, setJournalOpen] = useState(false)
  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'k' &&
        !document.querySelector('dialog[open]')
      ) {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', openSearch)
    return () => window.removeEventListener('keydown', openSearch)
  }, [])
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      return localStorage.getItem('theme') === 'light' ? 'light' : 'dark'
    } catch {
      return 'dark'
    }
  })
  const qc = useQueryClient()
  const [storageError, setStorageError] = useState('')
  const saved = (ok: boolean) => {
    setStorageError(ok ? '' : '저장하지 못했습니다. 브라우저 저장 공간과 개인정보 설정을 확인해 주세요.')
    return ok
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('theme', theme)
    } catch {
      /* theme remains available for this session */
    }
  }, [theme])

  // 장중에는 현재 구독 중인 시세만 갱신한다. 일정·뉴스·AI·기업 정보는 각 캐시를 유지한다.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (marketStatus('KR').open || marketStatus('US').open) {
        void qc.invalidateQueries({ predicate: (query) => query.isActive() && realtimeKeys.has(String(query.queryKey[0])) })
      }
    }, 60_000)
    return () => clearInterval(id)
  }, [qc])

  const [order, setOrder] = useState<string[]>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem('tickerOrder') || '[]')
      return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  })
  const tkey = (x: FocusTicker) => `${x.market}-${x.ticker}`
  const all = [
    ...new Map(
      [...TICKERS, ...custom.filter((x) => !TICKERS.some((t) => tkey(t) === tkey(x)))].map((x) => [tkey(x), x]),
    ).values(),
  ].sort((a, b) => {
    const ia = order.indexOf(tkey(a))
    const ib = order.indexOf(tkey(b))
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
  })
  const moveTicker = (k: string, dir: -1 | 1) => {
    const keys = all.map(tkey)
    const i = keys.indexOf(k)
    const j = i + dir
    if (i === -1 || j < 0 || j >= keys.length) return
    ;[keys[i], keys[j]] = [keys[j], keys[i]]
    if (saved(persist({ tickerOrder: keys }))) setOrder(keys)
  }

  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await qc.invalidateQueries()
      setUpdatedAt(new Date())
    } finally {
      setRefreshing(false)
    }
  }

  // 당겨서 새로고침 (PWA엔 브라우저 새로고침이 없어서)
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const touch = useRef({ y: 0, active: false })
  const PULL_THRESHOLD = 60

  const onTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY <= 0 && e.touches.length === 1) {
      touch.current = { y: e.touches[0].clientY, active: true }
    }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (!touch.current.active) return
    const d = e.touches[0].clientY - touch.current.y
    if (d > 0 && window.scrollY <= 0) setPull(Math.min(d * 0.4, 90))
    else setPull(0)
  }
  const onTouchEnd = () => {
    if (pull >= PULL_THRESHOLD) {
      void refresh()
    }
    setPull(0)
    touch.current.active = false
  }
  const addTicker = (tk: FocusTicker) => {
    if (all.some((x) => x.ticker === tk.ticker && x.market === tk.market)) return true
    const next = [...custom, tk]
    if (!saved(saveCustom(next))) return false
    setCustom(next)
    return true
  }
  const removeTicker = (tk: FocusTicker) => {
    const next = custom.filter((x) => !(x.ticker === tk.ticker && x.market === tk.market))
    if (!saved(saveCustom(next))) return false
    setCustom(next)
    if (t.ticker === tk.ticker && t.market === tk.market) setT(TICKERS[0])
  }
  const saveHolding = (h: Holding) => {
    const next = [...holdings.filter((x) => !(x.ticker === h.ticker && x.market === h.market)), h]
    if (!saved(saveHoldings(next))) return false
    setHoldings(next)
    return true
  }
  const removeHolding = (h: Holding) => {
    const next = holdings.filter((x) => !(x.ticker === h.ticker && x.market === h.market))
    if (!saved(saveHoldings(next))) return false
    setHoldings(next)
    return true
  }
  const addTrade = (t: Trade) => {
    const next = [...trades, t]
    if (!saved(saveTrades(next))) return false
    setTrades(next)
    return true
  }
  const removeTrade = (id: string) => {
    const next = trades.filter((x) => x.id !== id)
    if (!saved(saveTrades(next))) return false
    setTrades(next)
    return true
  }
  const importData = (input: Backup) => {
    const d = parseBackup(JSON.stringify(input))
    const values: Record<string, unknown> = {}
    if (d.holdings) values.holdings = d.holdings
    if (d.customTickers)
      values.customTickers = d.customTickers.filter(
        (x) => !TICKERS.some((t) => t.ticker === x.ticker && t.market === x.market),
      )
    if (d.trades) values['trades-v1'] = d.trades
    if (!saved(persist(values))) return false
    if (d.holdings) setHoldings(d.holdings)
    if (d.customTickers) setCustom(values.customTickers as FocusTicker[])
    if (d.trades) setTrades(d.trades)
    return true
  }

  return (
    <div className="min-h-screen" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {/* 당김 인디케이터 */}
      {(pull > 0 || refreshing) && (
        <div
          className="flex items-end justify-center overflow-hidden text-muted"
          style={{ height: refreshing ? 40 : pull }}
        >
          <span
            className="font-mono text-label pb-2 inline-flex items-center gap-1.5"
            style={{ opacity: refreshing ? 1 : Math.min(pull / PULL_THRESHOLD, 1) }}
          >
            <span
              className={refreshing ? 'animate-spin inline-block' : 'inline-block transition-transform'}
              style={refreshing ? undefined : { transform: `rotate(${(pull / PULL_THRESHOLD) * 180}deg)` }}
            >
              ↻
            </span>
            {refreshing ? '새로고침 중…' : pull >= PULL_THRESHOLD ? '놓으면 새로고침' : '당겨서 새로고침'}
          </span>
        </div>
      )}
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault()
          document.getElementById('main-content')?.focus()
        }}
      >
        본문으로 이동
      </a>
      <header className="app-header">
        <button className="brand" onClick={() => setTab('home')} aria-label="스톡 인사이트 홈">
          <span className="brand-mark">
            <Icon name="signal" size={24} />
          </span>
          <span>
            스톡 인사이트<small>STOCK INSIGHT</small>
          </span>
        </button>
        <button className="header-search" onClick={() => setSearchOpen(true)} aria-label="종목명 또는 티커 검색">
          <Icon name="search" />
          <span>종목명 또는 티커 검색</span>
          <span className="search-hint" aria-hidden="true">
            <kbd>Ctrl K</kbd>
          </span>
        </button>
        <div className="header-actions">
          <button
            className="icon-button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? '밝은 테마로 전환' : '어두운 테마로 전환'}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <button
            className="icon-button"
            onClick={() => void refresh()}
            disabled={refreshing}
            aria-label="새로고침"
          >
            <span className={refreshing ? 'animate-spin' : ''}>
              <Icon name="refresh" />
            </span>
          </button>
        </div>
      </header>
      <main id="main-content" className="app-main" tabIndex={-1}>
        {storageError && (
          <p role="alert" className="storage-error">
            {storageError}
          </p>
        )}
        {tab !== 'home' && tab !== 'calendar' && (
          <div className="page-heading is-research">
            <button className="icon-button back-button" onClick={() => setTab('home')} aria-label="관심종목으로">
              <Icon name="arrow" size={20} />
            </button>
            <h1 tabIndex={-1}>{TAB_LABELS[tab]}</h1>
            <span className="data-notice">
              지연 시세 · 참고용
              {updatedAt && (
                <small>
                  {updatedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 새로고침
                </small>
              )}
            </span>
          </div>
        )}
        {tab === 'home' ? (
          <div className="fade-in">
            <HomeView
              tickers={all}
              holdings={holdings}
              trades={trades}
              light={theme === 'light'}
              updatedAt={updatedAt}
              preferences={watchlistPreferences}
              onPreferencesChange={(next) => setWatchlistPreferences((previous) => ({ ...previous, ...next }))}
              onSelect={(tk) => {
                navigate('signal', tk)
              }}
              onAddClick={() => setSearchOpen(true)}
              onAddTicker={addTicker}
              onMove={moveTicker}
              onManageHoldings={() => setHoldingsOpen(true)}
              onOpenJournal={() => setJournalOpen(true)}
              onCompare={() => setComparisonOpen(true)}
              onOpenCalendar={() => navigate('calendar')}
            />
          </div>
        ) : tab === 'calendar' ? <CalendarView /> : (
          <>
            <TickerSwitcher tickers={all} selected={t} onSelect={setT} />
            <div className="research-layout">
              <aside className="research-summary" aria-label={`${t.name} 요약`}>
                <StockHeader key={`${t.market}-${t.ticker}`} t={t} period={period} light={theme === 'light'} />
                {(() => {
                  const h = holdings.find((x) => x.ticker === t.ticker && x.market === t.market)
                  return h ? <AverageBuyCard holding={h} /> : null
                })()}
                <Week52Bar t={t} />
              </aside>
              <section
                key={`${tab}-${t.market}-${t.ticker}`}
                className="research-body fade-in"
                aria-label={TAB_LABELS[tab]}
              >
                {tab === 'signal' && <SignalView t={t} />}
                {tab === 'tech' && (
                  <TechnicalView
                    t={t}
                    period={period}
                    setPeriod={setPeriod}
                    light={theme === 'light'}
                    holding={holdings.find((h) => h.ticker === t.ticker && h.market === t.market)}
                  />
                )}
                {tab === 'fund' && (
                  <FundamentalView t={t} tickers={all} onAddTicker={addTicker} onOpen={setT} onNavigate={setTab} />
                )}
                {tab === 'news' && <NewsView t={t} tickers={all} />}
              </section>
            </div>
          </>
        )}

        <footer className="app-footer">
          <span>STOCK INSIGHT</span>
          <p>
            지연 시세와 규칙 기반 분석을 제공합니다. 투자 판단의 참고 자료로 활용하세요.
            <br />
            관심종목·보유 기록은 이 브라우저에 저장됩니다.
          </p>
        </footer>
      </main>

      <BottomNav active={tab} onChange={setTab} ticker={t.short} />

      {searchOpen && (
        <SearchSheet
          existing={all}
          custom={custom}
          onAdd={addTicker}
          onRemove={removeTicker}
          onSelect={(tk) => navigate('signal', tk)}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {holdingsOpen && (
        <HoldingsSheet
          holdings={holdings}
          custom={custom}
          trades={trades}
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

      {journalOpen && (
        <TradeJournalSheet
          trades={trades}
          tickers={all}
          onAdd={addTrade}
          onRemove={removeTrade}
          onClose={() => setJournalOpen(false)}
        />
      )}
    </div>
  )
}
