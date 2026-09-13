import { useQuery } from '@tanstack/react-query'
import {
  getPrices,
  getSignal,
  getIndex,
  getProfile,
  getNightPrice,
  getSynthPrice,
  type Period,
} from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import { hasNightPrice, nightLabel, showSynthPrice } from '../lib/night'
import { pickQuote } from '../lib/quote'
import type { Holding } from '../lib/holdings'
import { loadSignalConfig, cfgKey, cfgParams } from '../lib/signalConfig'
import { fmtQuote, fmtChange, changeColor } from '../lib/format'
const UP = 'rgb(var(--up))'
const DOWN = 'rgb(var(--down))'

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
      <polyline
        points={pts}
        fill="none"
        stroke={up ? UP : DOWN}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

const VERDICT_COLOR: Record<string, string> = {
  '매수 우위': 'text-up',
  '매도 우위': 'text-down',
  중립: 'text-muted',
}

export default function WatchlistRow({
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
  const prices = useQuery({
    queryKey: ['prices', t.ticker, period],
    queryFn: () => getPrices(t.ticker, period),
  })
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

  // 장 마감 뒤에도 흐름을 보려는 게 이 기능의 요점이라 홈에서도 바로 보여준다.
  // 상세 화면과 같은 queryKey라 캐시를 공유한다(중복 요청 없음).
  const nightEnabled = hasNightPrice(t)
  const night = useQuery({
    queryKey: ['night-price', t.ticker],
    queryFn: () => getNightPrice(t.ticker),
    enabled: nightEnabled,
    refetchInterval: nightEnabled ? 60_000 : false,
  })

  // KORU 등 합성추정가 종목 — 상세 화면과 같은 queryKey라 캐시 공유(중복 요청 없음)
  const synthEnabled = showSynthPrice(t)
  const synth = useQuery({
    queryKey: ['synth-price', t.ticker],
    queryFn: () => getSynthPrice(t.ticker),
    enabled: synthEnabled,
    refetchInterval: synthEnabled ? 60_000 : false,
  })

  const series = prices.data?.map((c) => c.close) ?? []
  const last = prices.data?.at(-1)
  const {
    price: priceVal,
    change: chg,
    changePct: pct,
    hasChange,
  } = pickQuote(prices.data, isIndex ? idx.data : undefined)
  const up = hasChange ? chg >= 0 : series.length > 1 ? series[series.length - 1] >= series[0] : true
  const holdPct = holding && last ? (last.close / holding.avg - 1) * 100 : null

  return (
    <button onClick={onClick} className="watchlist-row" aria-label={`${t.name} 분석 열기`}>
      <div className="quote-main">
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
            <span className="font-semibold truncate" title={t.name}>
              {t.short}
            </span>
            {t.kind === 'etf' && <span className="font-mono text-label text-muted">{t.lev ?? 'ETF'}</span>}
            {t.kind === 'index' && <span className="font-mono text-label text-muted">지수</span>}
            {holding && (
              <span
                className={`font-mono text-label px-1 py-0.5 rounded border shrink-0 ${
                  holdPct != null && holdPct >= 0 ? 'border-up/40 text-up' : 'border-down/40 text-down'
                }`}
              >
                보유 {holdPct != null ? `${holdPct >= 0 ? '+' : ''}${holdPct.toFixed(1)}%` : ''}
              </span>
            )}
          </div>
          <div className="font-mono text-label text-muted mt-0.5">
            {t.market} · {t.ticker}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono font-semibold tnum text-body">
            {priceVal != null
              ? fmtQuote(priceVal, t)
              : prices.isPending
                ? '조회 중…'
                : prices.isError
                  ? '조회 실패'
                  : '시세 없음'}
          </div>
          {hasChange && (
            <div className={`font-mono text-label ${changeColor(chg)}`}>{fmtChange(pct, chg)}</div>
          )}
          {nightEnabled && night.data?.available && (
            <div className="flex items-center justify-end gap-1 mt-0.5">
              <span className="text-label text-muted">{nightLabel(t)}</span>
              <span className="font-mono text-label tnum text-muted">
                ₩{Math.round(night.data.krw ?? 0).toLocaleString()}
              </span>
              <span className={`font-mono text-label ${changeColor(night.data.gapPct ?? 0)}`}>
                {fmtChange(night.data.gapPct ?? 0)}
              </span>
            </div>
          )}
          {synthEnabled && synth.data?.available && (
            <div className="flex items-center justify-end gap-1 mt-0.5">
              <span className="text-label text-accent border border-accent/40 rounded px-1">추정</span>
              <span className="font-mono text-label tnum text-muted">{fmtQuote(synth.data.estimate, t)}</span>
              <span className={`font-mono text-label ${changeColor(synth.data.changePct ?? 0)}`}>
                {fmtChange(synth.data.changePct ?? 0)}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="quote-trend">
        <div className="flex-1 min-w-0">
          <Sparkline data={series} up={up} />
        </div>
        {!sig.data && (
          <span className="text-label text-muted shrink-0">{sig.isPending ? '분석 중' : '분석 없음'}</span>
        )}
        {sig.data && (
          <span
            className={`font-mono text-label font-semibold shrink-0 ${VERDICT_COLOR[sig.data.verdict] ?? 'text-muted'}`}
          >
            {sig.data.verdict}
          </span>
        )}
      </div>
    </button>
  )
}
