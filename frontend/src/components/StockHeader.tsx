import { lazy, Suspense, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPrices, getIndex, getProfile, getNightPrice, getSynthPrice, type Period } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import { fmtQuote, changeColor, changeSign } from '../lib/format'
import { marketStatus } from '../lib/market'
import { ChartFallback } from './ui'
import { hasNightPrice, nightLabel, showSynthPrice } from '../lib/night'

// 차트 라이브러리가 무거워서 '차트 보기'를 누를 때만 받는다.
const NightCandleChart = lazy(() => import('./NightCandleChart'))

export default function StockHeader({ t, period, light = false }: { t: FocusTicker; period: Period; light?: boolean }) {
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

  const last = prices.data?.[prices.data.length - 1]
  const prev = prices.data?.[prices.data.length - 2]

  // 지수는 실시간 API 값을, 그 외는 일봉 마지막 값을 사용
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

  return (
    <div className="pt-1 pb-3 border-b border-border">
      <div className="flex items-center gap-2 flex-wrap">
        {logo && (
          <img
            src={logo}
            alt=""
            className="h-6 w-6 rounded-full border border-border bg-surface object-contain"
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        )}
        <span className="text-lg font-bold tracking-tight">{t.name}</span>
        <span className="font-mono text-xs text-muted border border-border rounded px-1.5 py-0.5">
          {t.ticker} · {t.market}
        </span>
        {t.kind === 'etf' && (
          <span className="font-mono text-[0.6rem] text-accent border border-accent/40 rounded px-1.5 py-0.5">
            {t.lev ? `${t.lev} ETF` : 'ETF'}
          </span>
        )}
        {t.kind === 'index' && (
          <span className="font-mono text-[0.6rem] text-muted border border-border rounded px-1.5 py-0.5">
            지수
          </span>
        )}
        {(() => {
          const st = marketStatus(t.market)
          return (
            <span className={`flex items-center gap-1 text-[0.62rem] ${st.open ? 'text-accent' : 'text-muted'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${st.open ? 'bg-accent animate-pulse' : 'bg-muted'}`} />
              {st.label}
            </span>
          )
        })()}
        <button onClick={share} aria-label="공유" className="relative ml-auto text-muted active:text-text p-1 before:absolute before:-inset-4 before:content-['']">
          {copied ? (
            <span className="text-[0.62rem] text-accent">복사됨</span>
          ) : (
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12M8 7l4-4 4 4M5 12v8h14v-8" />
            </svg>
          )}
        </button>
      </div>
      <div className="flex items-baseline gap-3 mt-2">
        <span className="font-mono text-3xl font-semibold tnum tracking-tight">
          {fmtQuote(priceVal, t)}
        </span>
        {hasChange && (
          <span className={`font-mono text-sm font-semibold ${changeColor(chg)}`}>
            {changeSign(chg)} {Math.abs(pct).toFixed(2)}%
          </span>
        )}
      </div>
      {nightEnabled && night.data?.available && (
        <div className="flex items-baseline gap-2 mt-1">
          <span className="text-[0.62rem] text-muted">{nightLabel(t)}(perp)</span>
          <span className="font-mono text-sm font-medium tnum">
            ₩{Math.round(night.data.krw ?? 0).toLocaleString()}
          </span>
          <span className={`font-mono text-[0.7rem] ${changeColor(night.data.gapPct ?? 0)}`}>
            {changeSign(night.data.gapPct ?? 0)} {Math.abs(night.data.gapPct ?? 0).toFixed(2)}%
          </span>
          <button
            onClick={() => setShowNightChart((v) => !v)}
            className="relative ml-auto text-[0.62rem] text-accent px-2 py-0.5 rounded border border-accent/40 before:absolute before:-inset-4 before:content-['']"
          >
            {showNightChart ? '차트 닫기' : '차트 보기'}
          </button>
        </div>
      )}
      {synthEnabled && synth.data?.available && (
        <div className="mt-1.5 rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-2">
          <div className="flex items-baseline gap-2">
            <span className="text-[0.58rem] text-accent border border-accent/40 rounded px-1 py-0.5 shrink-0">
              추정
            </span>
            <span className="font-mono text-lg font-semibold tnum">
              {fmtQuote(synth.data.estimate, t)}
            </span>
            <span className={`font-mono text-[0.72rem] ${changeColor(synth.data.changePct ?? 0)}`}>
              {changeSign(synth.data.changePct ?? 0)}{' '}
              {Math.abs(synth.data.changePct ?? 0).toFixed(2)}%
            </span>
          </div>
          <div className="text-[0.6rem] text-muted mt-1 leading-relaxed">
            {synth.data.underlyingName} {(synth.data.underlyingPct ?? 0) >= 0 ? '+' : ''}
            {(synth.data.underlyingPct ?? 0).toFixed(2)}% × {synth.data.leverage}배로 계산 · 기준
            정규장 종가 {fmtQuote(synth.data.lastClose, t)}
          </div>
          <div className="text-[0.58rem] text-muted/70 mt-0.5">
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
