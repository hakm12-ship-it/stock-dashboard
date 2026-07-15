import { useQuery } from '@tanstack/react-query'
import { getValuation, getForwardPe, getTrend, getTarget, getPrices } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import { Panel, Loading, Empty, ErrorState, Metric } from '../components/ui'
import { fmtNum, fmtEps, fmtCap, fmtPrice } from '../lib/format'

function RevenueBars({
  years,
  series,
}: {
  years: number[]
  series: { label: string; color: string; values: (number | null)[] }[]
}) {
  const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => (v && v > 0 ? v : 0))))
  return (
    <div>
      <div className="flex items-end gap-2 h-36">
        {years.map((yr, i) => (
          <div key={yr} className="flex-1 flex items-end justify-center gap-[3px] h-full">
            {series.map((s) => {
              const v = s.values[i] ?? 0
              const h = v > 0 ? Math.max(3, (v / max) * 100) : 2
              return (
                <div
                  key={s.label}
                  className="flex-1 rounded-t-sm"
                  style={{ height: `${h}%`, backgroundColor: s.color }}
                />
              )
            })}
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-1">
        {years.map((yr) => (
          <div key={yr} className="flex-1 text-center text-[0.62rem] text-muted font-mono">
            {yr}
          </div>
        ))}
      </div>
      <div className="flex gap-3 justify-center mt-2">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1 text-[0.66rem] text-muted">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function FundamentalView({ t }: { t: FocusTicker }) {
  const isStock = t.kind === 'stock'
  const val = useQuery({ queryKey: ['val', t.market, t.ticker], queryFn: () => getValuation(t.market, t.ticker), enabled: isStock })
  const fpe = useQuery({ queryKey: ['fpe', t.market, t.ticker], queryFn: () => getForwardPe(t.market, t.ticker), enabled: isStock })
  const trend = useQuery({ queryKey: ['trend', t.market, t.ticker], queryFn: () => getTrend(t.market, t.ticker), enabled: isStock })
  const target = useQuery({ queryKey: ['target', t.market, t.ticker], queryFn: () => getTarget(t.market, t.ticker), enabled: isStock })
  const priceQ = useQuery({ queryKey: ['prices', t.ticker, '1m'], queryFn: () => getPrices(t.ticker, '1m'), enabled: isStock })

  if (!isStock) {
    const isIndex = t.kind === 'index'
    return (
      <Panel label={isIndex ? '지수 안내' : 'ETF 안내'}>
        <p className="text-sm text-muted leading-relaxed">
          {isIndex ? (
            <>
              <b className="text-text">{t.name}</b> 는 지수라 PER·PBR 같은 개별 기업 밸류에이션이 없어요.
              <br />
              차트·종합신호 탭에서 지수 흐름과 예상 변동 범위를 확인하세요.
            </>
          ) : (
            <>
              <b className="text-text">{t.name}</b> 는 ETF라 PER·PBR 같은 개별 기업 밸류에이션이 적용되지 않아요.
              <br />
              <span className="text-up">3배 레버리지</span> 상품이라 변동성이 매우 큽니다 — 차트·종합신호 탭에서 확인하세요.
            </>
          )}
        </p>
      </Panel>
    )
  }

  if (val.isLoading) return <Loading />
  if (val.isError) return <ErrorState onRetry={() => val.refetch()} />
  const v = val.data

  const cur = fpe.data?.trailing
  const yearsData = trend.data && 'years' in trend.data ? (trend.data as { years: number[] } & Record<string, (number | null)[]>) : null

  return (
    <div className="space-y-3">
      {v && (
        <div className="grid grid-cols-3 gap-2">
          <Metric label="PER" help="per" value={fmtNum(v.PER, 1)} />
          <Metric label="PBR" help="pbr" value={fmtNum(v.PBR, 2)} />
          <Metric label="EPS" help="eps" value={fmtEps(v.EPS, t.market)} />
          <Metric label="ROE" help="roe" value={v.ROE != null ? `${(v.ROE * 100).toFixed(1)}%` : '—'} />
          <Metric label="배당수익률" value={v.배당수익률 != null ? `${v.배당수익률.toFixed(2)}%` : '—'} />
          <Metric label="시가총액" value={fmtCap(v.시가총액, t.market)} />
        </div>
      )}

      {/* 애널리스트 목표주가 */}
      {(() => {
        const tp = target.data?.target
        const cur = priceQ.data?.at(-1)?.close
        if (!tp || !cur) return null
        const upside = (tp / cur - 1) * 100
        const rec = target.data?.recomm ?? null
        const recLabel = rec == null ? '—' : rec >= 3.5 ? '매수' : rec >= 2.5 ? '중립' : '매도'
        return (
          <Panel label="🎯 애널리스트 목표주가" help="target">
            <div className="grid grid-cols-2 gap-2">
              <Metric
                label="목표주가 (평균)"
                value={fmtPrice(tp, t.market)}
                sub={`${upside >= 0 ? '+' : ''}${upside.toFixed(1)}% 여력`}
                subClass={upside >= 0 ? 'text-up' : 'text-down'}
              />
              <Metric label="투자의견" value={recLabel} sub={rec != null ? `${rec.toFixed(2)} / 5` : undefined} />
            </div>
            <p className="text-[0.62rem] text-muted mt-2">
              증권사 컨센서스 평균 · 현재가 {fmtPrice(cur, t.market)} 기준 · 투자조언 아님
            </p>
          </Panel>
        )
      })()}

      {/* 미래 PER */}
      {fpe.data && fpe.data.forward.length > 0 && (
        <Panel label="미래 PER · 애널리스트 예상EPS 기준" help="fwdper">
          <div className={`grid gap-2 ${fpe.data.forward.length >= 2 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <Metric label="현재(실적)" value={fmtNum(cur, 1)} />
            {fpe.data.forward.map((f) => (
              <Metric
                key={f.period}
                label={f.period}
                value={fmtNum(f.per, 1)}
                sub={cur && f.per < cur ? '더 쌈' : ''}
                subClass="text-up"
              />
            ))}
          </div>
          <p className="text-[0.62rem] text-muted mt-2">
            현재가 ÷ 예상EPS. 컨센서스는 전망 변경에 따라 바뀝니다 · 투자조언 아님.
          </p>
        </Panel>
      )}

      {/* 연간 실적 */}
      {yearsData && yearsData.years?.length ? (
        <Panel label="연간 실적 추이">
          <RevenueBars
            years={yearsData.years}
            series={[
              { label: '매출', color: '#E0B84D', values: (yearsData['매출'] as (number | null)[]) ?? [] },
              { label: '영업이익', color: '#3B82F6', values: (yearsData['영업이익'] as (number | null)[]) ?? [] },
              { label: '순이익', color: '#8B94A3', values: (yearsData['순이익'] as (number | null)[]) ?? [] },
            ]}
          />
          <p className="text-[0.62rem] text-muted mt-3 text-center font-mono">
            {yearsData.years.at(-1)} · 매출 {fmtCap(yearsData['매출']?.at(-1) ?? null, t.market)} · 영업{' '}
            {fmtCap(yearsData['영업이익']?.at(-1) ?? null, t.market)} · 순익{' '}
            {fmtCap(yearsData['순이익']?.at(-1) ?? null, t.market)}
          </p>
        </Panel>
      ) : null}

      {!v && !val.isLoading && <Empty label="재무 정보를 불러오지 못했어요" />}
    </div>
  )
}
