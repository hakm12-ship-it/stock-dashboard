import { lazy, Suspense, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPrices, getIndex, getProfile, getNightPrice, getSynthPrice, type Period } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import { fmtQuote, fmtChange, fmtPrice, changeColor, changeSign } from '../lib/format'
import { useMarketStatus } from '../lib/useMarketStatus'
import { pickQuote } from '../lib/quote'
import { ChartFallback } from './ui'
import { hasNightPrice, nightLabel, showSynthPrice } from '../lib/night'

// 차트 라이브러리가 무거워서 '차트 보기'를 누를 때만 받는다.
const NightCandleChart = lazy(() => import('./NightCandleChart'))

export default function StockHeader({
  t,
  period,
  light = false,
}: {
  t: FocusTicker
  period: Period
  light?: boolean
}) {
  const isIndex = t.kind === 'index' && !!t.indexName
  const prices = useQuery({
    queryKey: ['prices', t.ticker, period],
    queryFn: () => getPrices(t.ticker, period),
  })
  const idx = useQuery({
    queryKey: ['index', t.indexName],
    queryFn: () => getIndex(t.indexName as string),
    enabled: isIndex,
  })
  const profile = useQuery({
    queryKey: ['profile', t.market, t.ticker],
    queryFn: () => getProfile(t.market, t.ticker),
    enabled: t.market === 'KR' && t.kind !== 'index',
  })
  const logo = profile.data?.logo

  const nightEnabled = hasNightPrice(t)
  const night = useQuery({
    queryKey: ['night-price', t.ticker],
    queryFn: () => getNightPrice(t.ticker),
    enabled: nightEnabled,
    refetchInterval: nightEnabled ? 30_000 : false,
  })

  // 미국 정규장 밖에서만: 기초자산 perp로 합성한 추정가
  const synthEnabled = showSynthPrice(t)
  const synth = useQuery({
    queryKey: ['synth-price', t.ticker],
    queryFn: () => getSynthPrice(t.ticker),
    enabled: synthEnabled,
    refetchInterval: synthEnabled ? 60_000 : false,
  })

  const {
    price: priceVal,
    change: chg,
    changePct: pct,
    hasChange,
  } = pickQuote(prices.data, isIndex ? idx.data : undefined)

  const [showNightChart, setShowNightChart] = useState(false)
  const [copied, setCopied] = useState(false)
  const share = async () => {
    const text = `${t.name} ${fmtQuote(priceVal, t)} (${changeSign(chg)}${Math.abs(pct).toFixed(2)}%) — 스톡 인사이트`
    const url = window.location.href
    if (navigator.share) {
      try {
        await navigator.share({ text, url })
      } catch {
        /* 사용자가 취소 */
      }
    } else {
      try {
        await navigator.clipboard.writeText(`${text}\n${url}`)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        /* ignore */
      }
    }
  }

  const st = useMarketStatus(t.market)
  const lastTime = (isIndex ? idx.data?.quoteAsOf : undefined) ?? prices.data?.at(-1)?.time
  const sessionText = st.open
    ? `${st.label} · 지연 시세`
    : `${st.label}${lastTime ? ` · ${lastTime.slice(5, 10).replace('-', '.')} ${st.uncertain ? '기준' : '종가'}` : ''}`

  return (
    <div className="stock-header">
      <div className="stock-title-row">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            {logo && (
              <img
                src={logo}
                alt=""
                className="h-6 w-6 rounded-full border border-border bg-surface object-contain shrink-0"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            )}
            <h2 className="stock-name">{t.name}</h2>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            <span className="stock-chip font-mono">
              {t.ticker} · {t.market}
            </span>
            {t.kind === 'etf' && <span className="stock-chip">{t.lev ? `${t.lev} ETF` : 'ETF'}</span>}
            {t.kind === 'index' && <span className="stock-chip">지수</span>}
            <span title={st.detail} className={`flex items-center gap-1 text-label ${st.open ? 'text-accent' : 'text-muted'}`}>
              <span
                className={`h-1.5 w-1.5 rounded-full ${st.open ? 'bg-accent animate-pulse' : 'bg-muted'}`}
                aria-hidden="true"
              />
              {sessionText}
            </span>
          </div>
        </div>
        <button onClick={share} aria-label={copied ? '링크 복사됨' : '공유'} className="icon-button shrink-0 -mr-2">
          {copied ? (
            <span className="text-label text-accent" role="status">
              복사됨
            </span>
          ) : (
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3v12M8 7l4-4 4 4M5 12v8h14v-8" />
            </svg>
          )}
        </button>
      </div>
      <div className="flex items-baseline flex-wrap gap-x-3 gap-y-1 mt-3">
        <span className="font-mono text-3xl font-semibold tnum tracking-tight whitespace-nowrap">
          {fmtQuote(priceVal, t)}
        </span>
        {hasChange && (
          <span className={`font-mono text-sm font-semibold tnum whitespace-nowrap ${changeColor(chg)}`}>
            {fmtChange(pct, chg)}
          </span>
        )}
      </div>
      {isIndex && idx.data?.history && (
        <p className="text-label text-muted mt-1" role="status">
          시세 {idx.data.quoteAsOf?.slice(0, 10) ?? '기준일 확인 중'} · {idx.data.quoteSource}
          {' / '}차트·분석 {idx.data.history.asOf ?? '기준일 없음'} 기준
          {idx.data.history.stale ? ' · 갱신 지연으로 분석 보류' : ''}
        </p>
      )}
      {(prices.isError || (isIndex && idx.isError)) && <p className="text-label text-muted mt-1" role="status">시세 갱신에 실패했습니다. 표시된 데이터의 기준일을 확인해 주세요.</p>}
      {nightEnabled && night.data?.available && (
        <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-1.5">
          <span
            className="text-label text-muted whitespace-nowrap"
            title="장 마감 뒤 해외 거래소의 무기한 선물 가격을 원화로 환산한 값"
          >
            {nightLabel(t)} 시세
          </span>
          <span className="font-mono text-sm font-medium tnum whitespace-nowrap">
            {fmtPrice(night.data.krw ?? 0, 'KR')}
          </span>
          <span className={`font-mono text-label tnum whitespace-nowrap ${changeColor(night.data.gapPct ?? 0)}`}>
            {fmtChange(night.data.gapPct ?? 0)}
          </span>
          <button
            onClick={() => setShowNightChart((v) => !v)}
            aria-expanded={showNightChart}
            className="text-action ml-auto whitespace-nowrap"
          >
            {showNightChart ? '야간 차트 닫기' : '야간 차트'}
          </button>
        </div>
      )}
      {synthEnabled && synth.data?.available && (
        <div className="mt-1.5 rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-2">
          <div className="flex items-baseline gap-2">
            <span className="text-label text-accent border border-accent/40 rounded px-1 py-0.5 shrink-0">
              추정
            </span>
            <span className="font-mono text-lg font-semibold tnum">{fmtQuote(synth.data.estimate, t)}</span>
            <span className={`font-mono text-label ${changeColor(synth.data.changePct ?? 0)}`}>
              {fmtChange(synth.data.changePct ?? 0)}
            </span>
          </div>
          <div className="text-label text-muted mt-1 leading-relaxed">
            {synth.data.underlyingName} {(synth.data.underlyingPct ?? 0) >= 0 ? '+' : ''}
            {(synth.data.underlyingPct ?? 0).toFixed(2)}% × {synth.data.leverage}배로 계산 · 기준 정규장 종가{' '}
            {fmtQuote(synth.data.lastClose, t)}
          </div>
          <div className="text-label text-muted mt-0.5">
            실제 체결가가 아니라 추정치예요 · 기초자산 흔들림이 {synth.data.leverage}배로 커져요
          </div>
        </div>
      )}
      {nightEnabled && showNightChart && (
        <div className="mt-2">
          <Suspense fallback={<ChartFallback height={250} />}>
            <NightCandleChart ticker={t.ticker} light={light} />
          </Suspense>
        </div>
      )}
    </div>
  )
}
