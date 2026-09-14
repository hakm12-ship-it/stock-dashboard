import { lazy, Suspense, useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPrices, getIndicators, getSignal, type Period } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import { Empty, ErrorState, ChartFallback } from '../components/ui'
import HelpTip from '../components/HelpTip'

// 차트 라이브러리가 무거워서 차트 탭에 들어올 때만 받는다.
const TechnicalCharts = lazy(() => import('../components/TechnicalCharts'))
import { toWeekly } from '../lib/aggregate'
import { loadSignalConfig, cfgKey, cfgParams } from '../lib/signalConfig'
import type { Holding } from '../lib/holdings'

const PERIODS: Period[] = ['1m', '3m', '6m', '1y']
const LABEL: Record<Period, string> = { '1m': '1개월', '3m': '3개월', '6m': '6개월', '1y': '1년' }

export default function TechnicalView({
  t,
  period,
  setPeriod,
  light,
  holding,
}: {
  t: FocusTicker
  period: Period
  setPeriod: (p: Period) => void
  light: boolean
  holding?: Holding
}) {
  const [showMA, setShowMA] = useState(true)
  const [showBB, setShowBB] = useState(false)
  const [showSR, setShowSR] = useState(true)
  // interval/setInterval로 두면 전역 setInterval을 가려 타이머가 조용히 깨진다
  const [tf, setTf] = useState<'D' | 'W'>('D')
  const weekly = tf === 'W'

  const prices = useQuery({ queryKey: ['prices', t.ticker, period], queryFn: () => getPrices(t.ticker, period) })
  const ind = useQuery({ queryKey: ['ind', t.ticker, period], queryFn: () => getIndicators(t.ticker, period) })
  const scfg = loadSignalConfig()
  const sig = useQuery({
    queryKey: ['signal', t.ticker, cfgKey(scfg)],
    queryFn: () => getSignal(t.ticker, cfgParams(scfg)),
  })

  // 현재가에 가까운 지지/저항 각각 2개만 (차트 어지럽지 않게)
  const levels = useMemo(
    () =>
      showSR && sig.data
        ? {
            support: sig.data.support.slice(0, 2).map((x) => x.value),
            resistance: sig.data.resistance.slice(0, 2).map((x) => x.value),
          }
        : undefined,
    [showSR, sig.data],
  )

  const chooseTf = (next: 'D' | 'W') => {
    setTf(next)
    // 주봉 1·3개월은 봉이 4~13개뿐이라 읽을 게 없다. 6개월로 넓힌다.
    if (next === 'W' && (period === '1m' || period === '3m')) setPeriod('6m')
  }

  return (
    <div className="space-y-3">
      {/* 기간 + 봉 간격 */}
      <div className="tech-toolbar">
        <div className="segmented" role="group" aria-label="차트 기간">
          {PERIODS.map((p) => (
            <button
              key={p}
              aria-pressed={p === period}
              disabled={weekly && (p === '1m' || p === '3m')}
              onClick={() => setPeriod(p)}
            >
              {LABEL[p]}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="봉 간격">
          {(['D', 'W'] as const).map((iv) => (
            <button key={iv} aria-pressed={iv === tf} onClick={() => chooseTf(iv)}>
              {iv === 'D' ? '일봉' : '주봉'}
            </button>
          ))}
        </div>
      </div>

      {/* 오버레이 토글 (일봉 지표라 주봉에선 안내로 바꾼다) */}
      <div className="tech-overlays">
        {weekly ? (
          <p className="text-label text-muted">주봉에서는 가격·거래량만 보여요. 이동평균·지지·저항·RSI·MACD는 일봉에서 확인하세요.</p>
        ) : (
          <>
            <Toggle on={showMA} onClick={() => setShowMA((v) => !v)} label="이동평균 20·60" help="ma" />
            <Toggle on={showBB} onClick={() => setShowBB((v) => !v)} label="볼린저" help="bollinger" />
            <Toggle on={showSR} onClick={() => setShowSR((v) => !v)} label="지지·저항" help="sr" />
          </>
        )}
      </div>

      {prices.isLoading || ind.isLoading ? (
        <ChartFallback height={weekly ? 320 : 560} />
      ) : prices.isError || ind.isError ? (
        <ErrorState
          label="차트 데이터를 불러오지 못했어요"
          onRetry={() => {
            prices.refetch()
            ind.refetch()
          }}
        />
      ) : prices.data && ind.data && prices.data.length ? (
        <Suspense fallback={<ChartFallback height={weekly ? 320 : 560} />}>
          <TechnicalCharts
            candles={weekly ? toWeekly(prices.data) : prices.data}
            ind={ind.data}
            showMA={!weekly && showMA}
            showBB={!weekly && showBB}
            light={light}
            levels={weekly ? undefined : levels}
            simple={weekly}
            avgPrice={holding?.avg}
            market={t.market}
            kind={t.kind}
          />
        </Suspense>
      ) : (
        <Empty label="차트로 그릴 가격 데이터가 없어요" />
      )}
    </div>
  )
}

function Toggle({ on, onClick, label, help }: { on: boolean; onClick: () => void; label: string; help: string }) {
  return (
    <span className="inline-flex items-center">
      <button onClick={onClick} aria-pressed={on} className={`toggle-chip ${on ? 'is-on' : ''}`}>
        <span className="toggle-check" aria-hidden="true" />
        {label}
      </button>
      <HelpTip term={help} />
    </span>
  )
}
