import { useState } from 'react'
import { TICKERS, type FocusTicker } from './data/tickers'
import type { Period } from './lib/api'
import IndexStrip from './components/IndexStrip'
import TickerSwitcher from './components/TickerSwitcher'
import StockHeader from './components/StockHeader'
import BottomNav, { type TabKey } from './components/BottomNav'
import SignalView from './views/SignalView'
import TechnicalView from './views/TechnicalView'
import FundamentalView from './views/FundamentalView'
import NewsView from './views/NewsView'

export default function App() {
  const [t, setT] = useState<FocusTicker>(TICKERS[0])
  const [period, setPeriod] = useState<Period>('3m')
  const [tab, setTab] = useState<TabKey>('signal')

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-app px-3 pt-3 pb-28 space-y-3">
        {/* 브랜드 */}
        <div className="flex items-center gap-2">
          <span className="text-base">📈</span>
          <span className="text-base font-bold tracking-tight">스톡 인사이트</span>
          <span className="font-mono text-[0.55rem] text-accent border border-accent/40 rounded px-1.5 py-0.5 tracking-[0.1em]">
            BETA
          </span>
        </div>

        <IndexStrip />
        <TickerSwitcher selected={t} onSelect={setT} />
        <StockHeader t={t} period={period} />

        <div className="pt-1">
          {tab === 'signal' && <SignalView t={t} />}
          {tab === 'tech' && <TechnicalView t={t} period={period} setPeriod={setPeriod} />}
          {tab === 'fund' && <FundamentalView t={t} />}
          {tab === 'news' && <NewsView t={t} />}
        </div>
      </div>

      <BottomNav active={tab} onChange={setTab} />
    </div>
  )
}
