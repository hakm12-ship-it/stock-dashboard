import { useState } from 'react'
import { useQuery, useQueries } from '@tanstack/react-query'
import { getPrices, getSignal, getIndex, getProfile, type Period } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import IndexStrip from '../components/IndexStrip'
import PortfolioSummary from '../components/PortfolioSummary'
import type { Holding } from '../lib/holdings'
import { loadSignalConfig, cfgKey, cfgParams } from '../lib/signalConfig'
import { fmtQuote, changeColor, changeSign } from '../lib/format'

const UP = '#F23645'
const DOWN = '#2E86FF'

function Sparkline({ data, up }: { data: number[]; up: boolean }) {
  if (!data || data.length < 2) return <div className="h-8" />
  const w = 120
  const h = 32
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 2) - 1}`)
    .join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={up ? UP : DOWN} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

const VERDICT_COLOR: Record<string, string> = {
  '매수 우위': 'text-up',
  '매도 우위': 'text-down',
  중립: 'text-muted',
}

function HomeCard({
  t,
  holding,
  period,
  onClick,
}: {
  t: FocusTicker
  holding?: Holding
  period: Period
  onClick: () => void
}) {
  const isIndex = t.kind === 'index' && !!t.indexName
  const prices = useQuery({ queryKey: ['prices', t.ticker, period], queryFn: () => getPrices(t.ticker, period) })
  const scfg = loadSignalConfig()
  const sig = useQuery({
    queryKey: ['signal', t.ticker, cfgKey(scfg)],
    queryFn: () => getSignal(t.ticker, cfgParams(scfg)),
  })
  const idx = useQuery({
    queryKey: ['index', t.indexName],
    queryFn: () => getIndex(t.indexName as string),
    enabled: isIndex,
  })
  const prof = useQuery({
    queryKey: ['profile', t.market, t.ticker],
    queryFn: () => getProfile(t.market, t.ticker),
    enabled: t.market === 'KR' && t.kind !== 'index',
  })
  const logo = prof.data?.logo

  const series = prices.data?.map((c) => c.close) ?? []
  const last = prices.data?.at(-1)
  const prev = prices.data?.at(-2)

  // 지수는 실시간 값, 그 외는 일봉 마지막
  let priceVal: number | undefined
  let chg = 0
  let pct = 0
  let hasChange = false
  if (isIndex && idx.data) {
    priceVal = idx.data.last
    chg = idx.data.change
    pct = idx.data.changePct
    hasChange = true
  } else if (last) {
    priceVal = last.close
    if (prev) {
      chg = last.close - prev.close
      pct = prev.close ? (chg / prev.close) * 100 : 0
      hasChange = true
    }
  }
  const up = hasChange ? chg >= 0 : series.length > 1 ? series[series.length - 1] >= series[0] : true
  const holdPct = holding && last ? (last.close / holding.avg - 1) * 100 : null

  return (
    <button
      onClick={onClick}
      className="w-full bg-surface border border-border rounded-xl p-3.5 card-shadow active:bg-surface-2 active:scale-[0.99] text-left transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {logo && (
              <img
                src={logo}
                alt=""
                className="h-5 w-5 rounded-full border border-border bg-surface object-contain shrink-0"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            )}
            <span className="font-semibold truncate">{t.short}</span>
            {t.kind === 'etf' && (
              <span className="font-mono text-[0.55rem] text-accent">{t.lev ?? 'ETF'}</span>
            )}
            {t.kind === 'index' && <span className="font-mono text-[0.55rem] text-muted">지수</span>}
            {holding && (
              <span
                className={`font-mono text-[0.55rem] px-1 py-0.5 rounded border shrink-0 ${
                  holdPct != null && holdPct >= 0 ? 'border-up/40 text-up' : 'border-down/40 text-down'
                }`}
              >
                보유 {holdPct != null ? `${holdPct >= 0 ? '+' : ''}${holdPct.toFixed(1)}%` : ''}
              </span>
            )}
          </div>
          <div className="font-mono text-[0.65rem] text-muted mt-0.5">{t.ticker}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono font-semibold tnum text-[0.95rem]">{fmtQuote(priceVal, t)}</div>
          {hasChange && (
            <div className={`font-mono text-[0.72rem] ${changeColor(chg)}`}>
              {changeSign(chg)} {Math.abs(pct).toFixed(2)}%
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 mt-2">
        <div className="flex-1 min-w-0">
          <Sparkline data={series} up={up} />
        </div>
        {sig.data && (
          <span className={`font-mono text-[0.7rem] font-semibold shrink-0 ${VERDICT_COLOR[sig.data.verdict] ?? 'text-muted'}`}>
            {sig.data.verdict}
          </span>
        )}
      </div>
    </button>
  )
}

export default function HomeView({
  tickers,
  holdings,
  light,
  onSelect,
  onAddClick,
  onManageHoldings,
  onCompare,
}: {
  tickers: FocusTicker[]
  holdings: Holding[]
  light: boolean
  onSelect: (t: FocusTicker) => void
  onAddClick: () => void
  onManageHoldings: () => void
  onCompare: () => void
}) {
  const [sort, setSort] = useState<'default' | 'gainers' | 'losers'>('default')
  const [sparkPeriod, setSparkPeriod] = useState<Period>('1m')

  // 정렬용 등락률 (카드와 같은 쿼리키 → 캐시 공유, 중복 요청 없음)
  const priceQs = useQueries({
    queries: tickers.map((t) => ({
      queryKey: ['prices', t.ticker, sparkPeriod],
      queryFn: () => getPrices(t.ticker, sparkPeriod),
    })),
  })
  const items = tickers.map((t, i) => {
    const d = priceQs[i].data
    const last = d?.at(-1)
    const prev = d?.at(-2)
    const pct = last && prev && prev.close ? ((last.close - prev.close) / prev.close) * 100 : null
    return { t, pct }
  })
  const ordered =
    sort === 'default'
      ? items
      : [...items].sort((a, b) => {
          const av = a.pct ?? (sort === 'gainers' ? -Infinity : Infinity)
          const bv = b.pct ?? (sort === 'gainers' ? -Infinity : Infinity)
          return sort === 'gainers' ? bv - av : av - bv
        })

  const SORTS: [typeof sort, string][] = [
    ['default', '기본'],
    ['gainers', '상승순'],
    ['losers', '하락순'],
  ]

  return (
    <div className="space-y-2">
      <PortfolioSummary holdings={holdings} light={light} onManage={onManageHoldings} />
      <IndexStrip />
      <div className="flex items-center justify-between pt-2 pb-0.5">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-muted">
          관심 종목
        </span>
        <div className="flex items-center gap-1">
          {(['1m', '3m', '6m'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setSparkPeriod(p)}
              className={`font-mono text-[0.6rem] px-1.5 py-1 rounded transition-colors ${
                sparkPeriod === p ? 'bg-accent/15 text-accent' : 'text-muted/70'
              }`}
            >
              {p.toUpperCase()}
            </button>
          ))}
          <span className="w-px h-3 bg-border mx-0.5" />
          {SORTS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={`text-[0.66rem] px-2 py-1 rounded-md transition-colors ${
                sort === k ? 'bg-accent/15 text-accent' : 'text-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {ordered.map(({ t }) => (
        <HomeCard
          key={`${t.market}-${t.ticker}`}
          t={t}
          period={sparkPeriod}
          holding={holdings.find((h) => h.ticker === t.ticker && h.market === t.market)}
          onClick={() => onSelect(t)}
        />
      ))}
      <div className="flex gap-2">
        <button
          onClick={onAddClick}
          className="flex-1 border border-dashed border-border rounded-xl py-3 text-muted text-sm active:bg-surface transition-colors"
        >
          + 종목 추가
        </button>
        <button
          onClick={onCompare}
          className="flex-1 border border-border rounded-xl py-3 text-muted text-sm active:bg-surface transition-colors"
        >
          ⚖️ 종목 비교
        </button>
      </div>
    </div>
  )
}
