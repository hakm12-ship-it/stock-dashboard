import { useId } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getIndex, getNightPrice, getSynthPrice, type Period, type WatchlistData } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import { hasNightPrice, nightLabel, showSynthPrice } from '../lib/night'
import { pickQuote } from '../lib/quote'
import type { Holding } from '../lib/holdings'
import { fmtQuote, fmtChange, fmtPct, fmtPrice, changeColor } from '../lib/format'
import Icon from './Icon'
const UP = 'rgb(var(--up))'
const DOWN = 'rgb(var(--down))'

function Sparkline({ data, up }: { data: number[]; up: boolean }) {
  if (!data || data.length < 2) return <div className="spark-empty" />
  const w = 120
  const h = 32
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 2) - 1}`)
    .join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="sparkline" preserveAspectRatio="none" aria-hidden="true">
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
  '매수 우위': 'text-up bg-up/10',
  '매도 우위': 'text-down bg-down/10',
  중립: 'text-muted bg-surface-2',
}

const PERIOD_LABEL: Partial<Record<Period, string>> = { '1m': '1개월', '3m': '3개월', '6m': '6개월', '1y': '1년' }

export default function WatchlistRow({
  t,
  holding,
  period,
  onClick,
  data,
  pending,
  failed,
}: {
  t: FocusTicker
  holding?: Holding
  period: Period
  onClick: () => void
  data?: WatchlistData
  pending: boolean
  failed: boolean
}) {
  const isIndex = t.kind === 'index' && !!t.indexName
  const prices = { data: data?.candles, isPending: pending, isError: failed || !!data?.error }
  const sig = { data: data?.signal, isPending: pending }
  const idx = useQuery({
    queryKey: ['index', t.indexName],
    queryFn: () => getIndex(t.indexName as string),
    enabled: isIndex,
  })

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
  // 선 색은 선이 그리는 기간의 등락을 따른다. 전일 대비 색은 가격 옆 숫자가 따로 보여준다.
  const trendUp = series.length > 1 ? series[series.length - 1] >= series[0] : hasChange ? chg >= 0 : true
  const periodPct = series.length > 1 && series[0] ? (series[series.length - 1] / series[0] - 1) * 100 : null
  const holdPct = holding && last ? (last.close / holding.avg - 1) * 100 : null
  const showNight = nightEnabled && !!night.data?.available
  const showSynth = synthEnabled && !!synth.data?.available
  const descId = useId()

  const priceText =
    priceVal != null
      ? fmtQuote(priceVal, t)
      : prices.isPending
        ? '조회 중…'
        : prices.isError
          ? '조회 실패'
          : '시세 없음'
  const description = [
    priceText,
    hasChange && pct != null ? `전일 대비 ${chg >= 0 ? '상승' : '하락'} ${Math.abs(pct).toFixed(2)}%` : '',
    holding ? `보유 손익 ${holdPct != null ? fmtPct(holdPct) : '평가 대기'}` : '',
    sig.data ? `종합 신호 ${sig.data.verdict}` : '',
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <button
      onClick={onClick}
      className={`watchlist-row ${showNight || showSynth ? 'has-sub' : ''}`}
      aria-label={`${t.name} 분석 열기`}
      aria-describedby={descId}
    >
      <span id={descId} className="sr-only">
        {description}
      </span>
      <div className="wl-info">
        <span className={`ticker-avatar ticker-avatar-${t.kind}`} aria-hidden="true">
          {t.kind === 'index' ? <Icon name="tech" size={18} /> : t.short.slice(0, 1)}
        </span>
        <div className="wl-identity">
          <div className="wl-name-line">
            <span className="wl-name" title={t.name}>
              {t.short}
            </span>
            {t.kind === 'etf' && <span className="wl-tag">{t.lev ?? 'ETF'}</span>}
            {t.kind === 'index' && <span className="wl-tag">지수</span>}
          </div>
          <div className="wl-meta">
            <span className="font-mono">
              <span className="wl-market">{t.market} · </span>
              {t.ticker}
            </span>
            {holding && (
              <span
                className={`hold-badge ${holdPct == null ? 'text-muted bg-surface-2' : holdPct >= 0 ? 'text-up bg-up/10' : 'text-down bg-down/10'}`}
              >
                보유 <span className="font-mono tnum">{holdPct != null ? fmtPct(holdPct) : '—'}</span>
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="wl-quote">
        <div
          className={`font-semibold tnum text-body ${priceVal != null ? 'font-mono' : 'text-muted text-caption'}`}
        >
          {priceText}
        </div>
        {hasChange && <div className={`font-mono tnum text-label ${changeColor(chg)}`}>{fmtChange(pct, chg)}</div>}
        {(data?.stale || failed) && <div className="text-label text-muted">{failed ? '갱신 실패' : `${data?.asOf ?? ''} 기준 · 갱신 지연`}</div>}
      </div>
      {(showNight || showSynth) && (
        <div className="wl-sub">
          {showNight && night.data && (
            <span className="wl-sub-line">
              <span className="text-muted">{nightLabel(t)}</span>
              <span className="font-mono tnum text-muted">{fmtPrice(night.data.krw ?? 0, 'KR')}</span>
              <span className={`font-mono tnum ${changeColor(night.data.gapPct ?? 0)}`}>
                {fmtChange(night.data.gapPct ?? 0)}
              </span>
            </span>
          )}
          {showSynth && synth.data && (
            <span className="wl-sub-line">
              <span className="text-muted">추정</span>
              <span className="font-mono tnum text-muted">{fmtQuote(synth.data.estimate, t)}</span>
              <span className={`font-mono tnum ${changeColor(synth.data.changePct ?? 0)}`}>
                {fmtChange(synth.data.changePct ?? 0)}
              </span>
            </span>
          )}
        </div>
      )}
      <div className="wl-spark">
        <Sparkline data={series} up={trendUp} />
        {periodPct != null && (
          <span
            title={`${PERIOD_LABEL[period] ?? period} 등락률`}
            className={`wl-period font-mono tnum ${trendUp ? 'text-up' : 'text-down'}`}
          >
            {fmtPct(periodPct, 1)}
          </span>
        )}
      </div>
      <div className="wl-signal">
        <span className={`signal-pill ${VERDICT_COLOR[sig.data?.verdict ?? ''] ?? 'text-muted bg-surface-2'}`}>
          <span className="signal-prefix">신호 </span>
          {sig.data ? sig.data.verdict : sig.isPending ? '분석 중' : '없음'}
        </span>
      </div>
    </button>
  )
}
