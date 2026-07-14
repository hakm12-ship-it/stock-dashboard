import { useQuery } from '@tanstack/react-query'
import { getValuation, getForwardPe, getTrend } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import { Panel, Loading, Empty, ErrorState, Metric } from '../components/ui'
import { fmtNum, fmtEps, fmtCap } from '../lib/format'

export default function FundamentalView({ t }: { t: FocusTicker }) {
  const isStock = t.kind === 'stock'
  const val = useQuery({ queryKey: ['val', t.market, t.ticker], queryFn: () => getValuation(t.market, t.ticker), enabled: isStock })
  const fpe = useQuery({ queryKey: ['fpe', t.market, t.ticker], queryFn: () => getForwardPe(t.market, t.ticker), enabled: isStock })
  const trend = useQuery({ queryKey: ['trend', t.market, t.ticker], queryFn: () => getTrend(t.market, t.ticker), enabled: isStock })

  if (!isStock) {
    return (
      <Panel label="ETF 안내">
        <p className="text-sm text-muted leading-relaxed">
          <b className="text-text">{t.name}</b> 는 ETF라 PER·PBR 같은 개별 기업 밸류에이션이 적용되지 않아요.
          <br />
          <span className="text-up">3배 레버리지</span> 상품이라 변동성이 매우 큽니다 — 차트·종합신호 탭에서 가격 흐름과 예상 변동 범위를 확인하세요.
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
          <Metric label="PER" value={fmtNum(v.PER, 1)} />
          <Metric label="PBR" value={fmtNum(v.PBR, 2)} />
          <Metric label="EPS" value={fmtEps(v.EPS, t.market)} />
          <Metric label="ROE" value={v.ROE != null ? `${(v.ROE * 100).toFixed(1)}%` : '—'} />
          <Metric label="배당수익률" value={v.배당수익률 != null ? `${v.배당수익률.toFixed(2)}%` : '—'} />
          <Metric label="시가총액" value={fmtCap(v.시가총액, t.market)} />
        </div>
      )}

      {/* 미래 PER */}
      {fpe.data && fpe.data.forward.length > 0 && (
        <Panel label="미래 PER · 애널리스트 예상EPS 기준">
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
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-xs font-mono tnum">
              <thead>
                <tr className="text-muted text-[0.66rem]">
                  <th className="text-left font-medium py-1">연도</th>
                  <th className="text-right font-medium">매출</th>
                  <th className="text-right font-medium">영업이익</th>
                  <th className="text-right font-medium">순이익</th>
                </tr>
              </thead>
              <tbody>
                {yearsData.years.map((yr, i) => (
                  <tr key={yr} className="border-t border-border">
                    <td className="py-1.5 text-left text-muted">{yr}</td>
                    <td className="text-right">{fmtCap(yearsData['매출']?.[i] ?? null, t.market)}</td>
                    <td className="text-right">{fmtCap(yearsData['영업이익']?.[i] ?? null, t.market)}</td>
                    <td className="text-right">{fmtCap(yearsData['순이익']?.[i] ?? null, t.market)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      {!v && !val.isLoading && <Empty label="재무 정보를 불러오지 못했어요" />}
    </div>
  )
}
