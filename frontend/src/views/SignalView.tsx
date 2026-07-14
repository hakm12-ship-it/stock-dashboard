import { useQuery } from '@tanstack/react-query'
import { getSignal, getForecast, getValuation } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import { Panel, Loading, Empty, ErrorState, Metric } from '../components/ui'
import { fmtPrice, fmtNum, fmtPct } from '../lib/format'

const VERDICT_STYLE: Record<string, string> = {
  '매수 우위': 'bg-up/15 border-up/50 text-up',
  '매도 우위': 'bg-down/15 border-down/50 text-down',
  중립: 'bg-surface-2 border-border text-muted',
}

function band(v: number | null, lo: number, hi: number, labels: [string, string, string]) {
  if (v == null) return '—'
  return v < lo ? labels[0] : v > hi ? labels[2] : labels[1]
}

export default function SignalView({ t }: { t: FocusTicker }) {
  const sig = useQuery({ queryKey: ['signal', t.ticker], queryFn: () => getSignal(t.ticker) })
  const fc = useQuery({ queryKey: ['forecast', t.ticker], queryFn: () => getForecast(t.ticker) })
  const val = useQuery({ queryKey: ['val', t.market, t.ticker], queryFn: () => getValuation(t.market, t.ticker) })

  if (sig.isLoading) return <Loading />
  if (sig.isError) return <ErrorState onRetry={() => sig.refetch()} />
  if (!sig.data) return <Empty />
  const s = sig.data

  // 예상 변동 범위 (마지막 밴드)
  const b = fc.data?.band.at(-1)
  const cur = fc.data?.last ?? s.price
  let pos = 50
  if (b) pos = ((cur - b.lower_outer) / (b.upper_outer - b.lower_outer)) * 100

  return (
    <div className="space-y-3">
      <p className="text-[0.7rem] text-muted leading-relaxed">
        ⚠️ 과거 가격·지표를 규칙으로 요약한 참고용 정보입니다. 예측·투자조언이 아니며 판단·책임은 본인에게 있습니다.
      </p>

      {/* 판정 */}
      <div className={`rounded-xl border px-4 py-3 ${VERDICT_STYLE[s.verdict] ?? VERDICT_STYLE['중립']}`}>
        <div className="text-[0.68rem] uppercase tracking-[0.08em] opacity-80">기술적 신호 종합</div>
        <div className="text-lg font-bold mt-0.5">
          {s.verdict}{' '}
          <span className="font-mono text-sm opacity-80">({s.total > 0 ? '+' : ''}{s.total} / ±5)</span>
        </div>
      </div>

      {/* 예상 변동 범위 */}
      {b && (
        <Panel label="🔮 예상 변동 범위 · 향후 7거래일">
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Metric label="예상 하단" value={fmtPrice(b.lower_inner, t.market)} sub={fmtPct(((b.lower_inner / cur) - 1) * 100)} subClass="text-down" />
            <Metric label="현재가" value={fmtPrice(cur, t.market)} />
            <Metric label="예상 상단" value={fmtPrice(b.upper_inner, t.market)} sub={fmtPct(((b.upper_inner / cur) - 1) * 100)} subClass="text-up" />
          </div>
          <div className="relative h-3 rounded-full bg-surface-2 overflow-hidden">
            <div
              className="absolute inset-y-0 bg-muted/25"
              style={{
                left: `${((b.lower_inner - b.lower_outer) / (b.upper_outer - b.lower_outer)) * 100}%`,
                right: `${((b.upper_outer - b.upper_inner) / (b.upper_outer - b.lower_outer)) * 100}%`,
              }}
            />
            <div className="absolute top-0 bottom-0 w-0.5 bg-accent" style={{ left: `${pos}%` }} />
          </div>
          <div className="flex justify-between mt-1.5 font-mono text-[0.62rem] text-muted">
            <span>{fmtPrice(b.lower_outer, t.market)}</span>
            <span>{fmtPrice(b.upper_outer, t.market)}</span>
          </div>
          <p className="text-[0.62rem] text-muted mt-2">
            변동성 {fc.data ? (fc.data.sigma * 100).toFixed(1) : '—'}% 기준 · 진한띠 ≈68% · 방향 예측 아님
          </p>
        </Panel>
      )}

      {/* 신호 근거 */}
      <Panel label="신호 근거">
        <ul className="space-y-2">
          {s.signals.map((it) => (
            <li key={it.name} className="flex gap-2.5 text-sm">
              <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${it.score > 0 ? 'bg-up' : it.score < 0 ? 'bg-down' : 'bg-muted'}`} />
              <span>
                <span className="font-semibold">{it.name}</span>
                <span className="text-muted"> — {it.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      {/* 참고 가격대 */}
      <Panel label="참고 가격대">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-[0.66rem] text-down font-semibold mb-1.5">지지 (매수 관심)</div>
            {s.support.length ? s.support.map((x) => (
              <div key={x.label} className="flex justify-between text-xs py-0.5">
                <span className="font-mono tnum">{fmtPrice(x.value, t.market)}</span>
                <span className="text-muted">{x.label}</span>
              </div>
            )) : <div className="text-[0.7rem] text-muted">없음</div>}
          </div>
          <div>
            <div className="text-[0.66rem] text-up font-semibold mb-1.5">저항 (매도 관심)</div>
            {s.resistance.length ? s.resistance.map((x) => (
              <div key={x.label} className="flex justify-between text-xs py-0.5">
                <span className="font-mono tnum">{fmtPrice(x.value, t.market)}</span>
                <span className="text-muted">{x.label}</span>
              </div>
            )) : <div className="text-[0.7rem] text-muted">없음</div>}
          </div>
        </div>
      </Panel>

      {/* 밸류에이션 참고 (주식만) */}
      {t.kind === 'stock' && val.data && (
        <Panel label="밸류에이션 참고">
          <div className="grid grid-cols-3 gap-2">
            <Metric label="PER" value={fmtNum(val.data.PER, 1)} sub={band(val.data.PER, 10, 25, ['낮음', '보통', '높음'])} />
            <Metric label="PBR" value={fmtNum(val.data.PBR, 2)} sub={band(val.data.PBR, 1, 3, ['낮음', '보통', '높음'])} />
            <Metric label="ROE" value={val.data.ROE != null ? `${(val.data.ROE * 100).toFixed(1)}%` : '—'} sub={band(val.data.ROE, 0.05, 0.15, ['낮음', '보통', '우수'])} />
          </div>
        </Panel>
      )}
    </div>
  )
}
