import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSignal, getForecast, getValuation, getSignalHistory, type SignalPerf } from '../lib/api'
import {
  loadSignalConfig,
  saveSignalConfig,
  cfgParams,
  cfgKey,
  isDefaultConfig,
  DEFAULT_SIGNAL_CONFIG,
  type SignalConfig,
} from '../lib/signalConfig'
import type { FocusTicker } from '../data/tickers'
import { Panel, Loading, Empty, ErrorState, Metric } from '../components/ui'
import { fmtQuote, fmtNum, fmtPct } from '../lib/format'

const VERDICT_STYLE: Record<string, string> = {
  '매수 우위': 'bg-up/15 border-up/50 text-up',
  '매도 우위': 'bg-down/15 border-down/50 text-down',
  중립: 'bg-surface-2 border-border text-muted',
}

function band(v: number | null, lo: number, hi: number, labels: [string, string, string]) {
  if (v == null) return '—'
  return v < lo ? labels[0] : v > hi ? labels[2] : labels[1]
}

const IND_LABELS: [keyof SignalConfig['w'], string][] = [
  ['rsi', 'RSI'],
  ['macd', 'MACD'],
  ['ma20', '단기 추세(20일선)'],
  ['cross', '이평 배열'],
  ['boll', '볼린저 위치'],
]

function ConfigSheet({
  cfg,
  onApply,
  onClose,
}: {
  cfg: SignalConfig
  onApply: (c: SignalConfig) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<SignalConfig>(cfg)
  const setW = (k: keyof SignalConfig['w'], v: number) =>
    setDraft((d) => ({ ...d, w: { ...d.w, [k]: v } }))

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-end justify-center fade-in" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-t-2xl p-5 w-full max-w-app card-shadow max-h-[85vh] overflow-y-auto pb-safe"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-base font-bold">신호 규칙 설정</span>
          <button onClick={onClose} className="text-muted text-2xl leading-none px-1">×</button>
        </div>
        <p className="text-[0.66rem] text-muted mb-4">
          종합신호·과거성과(백테스트)에 함께 적용돼요. 판정 문턱은 최대점수의 40%로 자동 조정.
        </p>

        <div className="text-[0.7rem] font-semibold uppercase tracking-[0.07em] text-muted mb-2">
          지표 가중치
        </div>
        <div className="space-y-2 mb-4">
          {IND_LABELS.map(([k, label]) => (
            <div key={k} className="flex items-center justify-between gap-2">
              <span className="text-sm">{label}</span>
              <div className="flex gap-1">
                {[0, 1, 2].map((v) => (
                  <button
                    key={v}
                    onClick={() => setW(k, v)}
                    className={`font-mono text-xs px-3 py-1.5 rounded-md border transition-colors ${
                      draft.w[k] === v
                        ? 'bg-accent/15 border-accent text-accent'
                        : 'border-border text-muted'
                    }`}
                  >
                    {v === 0 ? '끔' : `${v}×`}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="text-[0.7rem] font-semibold uppercase tracking-[0.07em] text-muted mb-2">
          RSI 기준값
        </div>
        <div className="flex gap-3 mb-5">
          <label className="flex-1 text-xs text-muted">
            과매도 (반등 기대)
            <select
              value={draft.rsiLow}
              onChange={(e) => setDraft((d) => ({ ...d, rsiLow: Number(e.target.value) }))}
              className="w-full mt-1 bg-ink border border-border rounded-lg px-2 py-2 text-sm text-text"
            >
              {[20, 25, 30, 35, 40].map((v) => (
                <option key={v} value={v}>{v} 이하</option>
              ))}
            </select>
          </label>
          <label className="flex-1 text-xs text-muted">
            과매수 (과열)
            <select
              value={draft.rsiHigh}
              onChange={(e) => setDraft((d) => ({ ...d, rsiHigh: Number(e.target.value) }))}
              className="w-full mt-1 bg-ink border border-border rounded-lg px-2 py-2 text-sm text-text"
            >
              {[60, 65, 70, 75, 80].map((v) => (
                <option key={v} value={v}>{v} 이상</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setDraft(DEFAULT_SIGNAL_CONFIG)}
            className="flex-1 border border-border rounded-xl py-2.5 text-sm text-muted active:bg-surface-2"
          >
            기본값으로
          </button>
          <button
            onClick={() => {
              onApply(draft)
              onClose()
            }}
            className="flex-[2] bg-accent/15 border border-accent/50 text-accent rounded-xl py-2.5 text-sm font-semibold active:bg-accent/25"
          >
            적용
          </button>
        </div>
      </div>
    </div>
  )
}

function PerfBox({
  label,
  perf,
  horizon,
}: {
  label: string
  perf: SignalPerf | null
  horizon: number
}) {
  if (!perf) {
    return (
      <div className="bg-surface-2/60 border border-border rounded-lg p-3">
        <div className="text-[0.66rem] font-semibold uppercase tracking-[0.06em] text-muted">{label}</div>
        <div className="text-xs text-muted mt-2">신호 없음</div>
      </div>
    )
  }
  const r = perf.avgReturn
  return (
    <div className="bg-surface-2/60 border border-border rounded-lg p-3">
      <div className="text-[0.66rem] font-semibold uppercase tracking-[0.06em] text-muted">{label}</div>
      <div className={`font-mono text-lg font-semibold tnum mt-1 ${r >= 0 ? 'text-up' : 'text-down'}`}>
        {r >= 0 ? '+' : ''}
        {r.toFixed(2)}%
      </div>
      <div className="font-mono text-[0.66rem] text-muted mt-0.5">
        {horizon}일 평균 · {perf.count}회 · 적중 {perf.winRate.toFixed(0)}%
      </div>
    </div>
  )
}

export default function SignalView({ t }: { t: FocusTicker }) {
  const [cfg, setCfg] = useState<SignalConfig>(loadSignalConfig)
  const [cfgOpen, setCfgOpen] = useState(false)
  const key = cfgKey(cfg)
  const params = cfgParams(cfg)

  const sig = useQuery({ queryKey: ['signal', t.ticker, key], queryFn: () => getSignal(t.ticker, params) })
  const fc = useQuery({ queryKey: ['forecast', t.ticker], queryFn: () => getForecast(t.ticker) })
  const val = useQuery({ queryKey: ['val', t.market, t.ticker], queryFn: () => getValuation(t.market, t.ticker) })
  const hist = useQuery({ queryKey: ['sighist', t.ticker, key], queryFn: () => getSignalHistory(t.ticker, params) })

  const applyCfg = (c: SignalConfig) => {
    setCfg(c)
    saveSignalConfig(c)
  }

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
      <div className={`rounded-xl border px-4 py-3.5 card-shadow ${VERDICT_STYLE[s.verdict] ?? VERDICT_STYLE['중립']}`}>
        <div className="flex items-center justify-between">
          <span className="text-[0.66rem] uppercase tracking-[0.09em] opacity-70">
            기술적 신호 종합{!isDefaultConfig(cfg) && ' · 내 규칙'}
          </span>
          <button onClick={() => setCfgOpen(true)} aria-label="신호 규칙 설정" className="opacity-70 active:opacity-100 text-sm leading-none">
            ⚙️
          </button>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="h-2.5 w-2.5 rounded-full bg-current opacity-90" />
          <span className="text-xl font-bold">{s.verdict}</span>
          <span className="ml-auto font-mono text-sm opacity-70">
            {s.total > 0 ? '+' : ''}
            {s.total} / ±{s.maxScore ?? 5}
          </span>
        </div>
      </div>

      {cfgOpen && <ConfigSheet cfg={cfg} onApply={applyCfg} onClose={() => setCfgOpen(false)} />}

      {/* 예상 변동 범위 */}
      {b && (
        <Panel label="🔮 예상 변동 범위 · 향후 7거래일" help="forecast">
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Metric label="예상 하단" value={fmtQuote(b.lower_inner, t)} sub={fmtPct(((b.lower_inner / cur) - 1) * 100)} subClass="text-down" />
            <Metric label="현재가" value={fmtQuote(cur, t)} />
            <Metric label="예상 상단" value={fmtQuote(b.upper_inner, t)} sub={fmtPct(((b.upper_inner / cur) - 1) * 100)} subClass="text-up" />
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
            <span>{fmtQuote(b.lower_outer, t)}</span>
            <span>{fmtQuote(b.upper_outer, t)}</span>
          </div>
          <p className="text-[0.62rem] text-muted mt-2">
            변동성 {fc.data ? (fc.data.sigma * 100).toFixed(1) : '—'}% 기준 · 진한띠 ≈68% · 방향 예측 아님
          </p>
        </Panel>
      )}

      {/* 신호 근거 */}
      <Panel label="신호 근거" help="verdict">
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

      {/* 신호 과거 성과 (미니 백테스트) */}
      {hist.data && (hist.data.buy || hist.data.sell) && (
        <Panel label="🧪 최근 1년, 이 신호의 성과" help="backtest">
          <div className="grid grid-cols-2 gap-2">
            <PerfBox label="매수 우위 후" perf={hist.data.buy} horizon={hist.data.horizon} />
            <PerfBox label="매도 우위 후" perf={hist.data.sell} horizon={hist.data.horizon} />
          </div>
          <p className="text-[0.62rem] text-muted mt-2">
            같은 규칙을 지난 1년에 적용한 결과 · 신호일로부터 {hist.data.horizon}거래일 뒤 기준 · 과거
            성과가 미래를 보장하지 않아요
          </p>
        </Panel>
      )}

      {/* 참고 가격대 */}
      <Panel label="참고 가격대" help="sr">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-[0.66rem] text-down font-semibold mb-1.5">지지 (매수 관심)</div>
            {s.support.length ? s.support.map((x) => (
              <div key={x.label} className="flex justify-between text-xs py-0.5">
                <span className="font-mono tnum">{fmtQuote(x.value, t)}</span>
                <span className="text-muted">{x.label}</span>
              </div>
            )) : <div className="text-[0.7rem] text-muted">없음</div>}
          </div>
          <div>
            <div className="text-[0.66rem] text-up font-semibold mb-1.5">저항 (매도 관심)</div>
            {s.resistance.length ? s.resistance.map((x) => (
              <div key={x.label} className="flex justify-between text-xs py-0.5">
                <span className="font-mono tnum">{fmtQuote(x.value, t)}</span>
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
            <Metric label="PER" help="per" value={fmtNum(val.data.PER, 1)} sub={band(val.data.PER, 10, 25, ['낮음', '보통', '높음'])} />
            <Metric label="PBR" help="pbr" value={fmtNum(val.data.PBR, 2)} sub={band(val.data.PBR, 1, 3, ['낮음', '보통', '높음'])} />
            <Metric label="ROE" help="roe" value={val.data.ROE != null ? `${(val.data.ROE * 100).toFixed(1)}%` : '—'} sub={band(val.data.ROE, 0.05, 0.15, ['낮음', '보통', '우수'])} />
          </div>
        </Panel>
      )}
    </div>
  )
}
