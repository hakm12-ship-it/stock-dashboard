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
import AiBriefingPanel from '../components/AiBriefingPanel'
import FxAttributionPanel from '../components/FxAttributionPanel'
import LeverageDecayPanel from '../components/LeverageDecayPanel'
import NightGapHistoryPanel from '../components/NightGapHistoryPanel'
import RelatedInsightPanel from '../components/RelatedInsightPanel'
import { Panel, Loading, Empty, ErrorState, Metric, Sheet } from '../components/ui'

const RELATED_INSIGHT_TICKERS = new Set(['005930', '000660'])
import { fmtQuote, fmtNum, fmtPct } from '../lib/format'
import Icon from '../components/Icon'

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
  const setW = (k: keyof SignalConfig['w'], v: number) => setDraft((d) => ({ ...d, w: { ...d.w, [k]: v } }))

  return (
    <Sheet title="신호 규칙 설정" onClose={onClose}>
      <p className="text-label text-muted mb-4">
        종합 신호와 과거 성과 계산에 함께 적용돼요. 지표를 끄거나 비중을 2배로 올릴 수 있고, 매수·매도 우위
        판정 기준은 최대 점수의 40%로 자동으로 맞춰져요.
      </p>

      <div className="section-label mb-2">지표 가중치</div>
      <div className="space-y-2 mb-4">
        {IND_LABELS.map(([k, label]) => (
          <div key={k} className="flex items-center justify-between gap-2">
            <span className="text-sm">{label}</span>
            <div className="flex gap-1">
              {[0, 1, 2].map((v) => (
                <button
                  key={v}
                  aria-label={`${label} ${v}배`}
                  aria-pressed={draft.w[k] === v}
                  onClick={() => setW(k, v)}
                  className={`choice-button ${draft.w[k] === v ? 'is-selected' : ''}`}
                >
                  {v === 0 ? '끔' : v === 1 ? '보통' : '2배'}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="section-label mb-2">RSI 기준값</div>
      <div className="flex gap-3 mb-5">
        <label className="flex-1 field-label">
          과매도 (반등 기대)
          <select
            value={draft.rsiLow}
            onChange={(e) => setDraft((d) => ({ ...d, rsiLow: Number(e.target.value) }))}
            className="field"
          >
            {[20, 25, 30, 35, 40].map((v) => (
              <option key={v} value={v}>
                {v} 이하
              </option>
            ))}
          </select>
        </label>
        <label className="flex-1 field-label">
          과매수 (과열)
          <select
            value={draft.rsiHigh}
            onChange={(e) => setDraft((d) => ({ ...d, rsiHigh: Number(e.target.value) }))}
            className="field"
          >
            {[60, 65, 70, 75, 80].map((v) => (
              <option key={v} value={v}>
                {v} 이상
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setDraft(DEFAULT_SIGNAL_CONFIG)} className="button button-quiet flex-1">
          기본값으로
        </button>
        <button
          onClick={() => {
            onApply(draft)
            onClose()
          }}
          className="button button-primary flex-[2]"
        >
          적용
        </button>
      </div>
    </Sheet>
  )
}

function PerfBox({ label, perf, horizon }: { label: string; perf: SignalPerf | null; horizon: number }) {
  if (!perf) {
    return (
      <div className="bg-surface-2/60 border border-border rounded-lg p-3">
        <div className="section-label">{label}</div>
        <div className="text-xs text-muted mt-2">신호 없음</div>
      </div>
    )
  }
  const r = perf.avgReturn
  return (
    <div className="bg-surface-2/60 border border-border rounded-lg p-3">
      <div className="section-label">{label}</div>
      <div className={`font-mono text-lg font-semibold tnum mt-1 ${r >= 0 ? 'text-up' : 'text-down'}`}>
        {r >= 0 ? '+' : ''}
        {r.toFixed(2)}%
      </div>
      <div className="font-mono text-label text-muted mt-0.5">
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
  const val = useQuery({
    queryKey: ['val', t.market, t.ticker],
    queryFn: () => getValuation(t.market, t.ticker),
  })
  const hist = useQuery({
    queryKey: ['sighist', t.ticker, key],
    queryFn: () => getSignalHistory(t.ticker, params),
  })

  const applyCfg = (c: SignalConfig) => {
    setCfg(c)
    saveSignalConfig(c)
  }

  if (sig.isLoading) return <Loading />
  if (sig.isError) return <ErrorState label="종합 신호를 불러오지 못했어요. 차트·기업 가치 탭은 따로 확인할 수 있어요." onRetry={() => sig.refetch()} />
  if (!sig.data) return <Empty />
  const s = sig.data

  // 예상 변동 범위 (마지막 밴드)
  const b = fc.data?.band.at(-1)
  const cur = fc.data?.last ?? s.price
  let pos = 50
  if (b) pos = ((cur - b.lower_outer) / (b.upper_outer - b.lower_outer)) * 100

  const maxScore = s.maxScore ?? 5
  const scorePos = Math.min(100, Math.max(0, ((s.total + maxScore) / (maxScore * 2)) * 100))

  return (
    <div className="space-y-3">
      {/* 판정 */}
      <section
        className={`rounded-xl border px-4 py-3.5 card-shadow ${VERDICT_STYLE[s.verdict] ?? VERDICT_STYLE['중립']}`}
        aria-labelledby="verdict-title"
      >
        <div className="flex items-center justify-between -my-2">
          <h2 id="verdict-title" className="text-label opacity-80">
            기술적 신호 종합{!isDefaultConfig(cfg) && ' · 내 규칙 적용'}
          </h2>
          <button onClick={() => setCfgOpen(true)} aria-label="신호 규칙 설정" className="icon-button -mr-2">
            <Icon name="settings" size={18} />
          </button>
        </div>
        <div className="flex items-baseline gap-2 mt-1">
          <span className="text-xl font-bold">{s.verdict}</span>
          <span className="ml-auto font-mono text-sm tnum opacity-80">
            점수 {s.total > 0 ? '+' : s.total < 0 ? '−' : ''}
            {Math.abs(s.total)}
          </span>
        </div>
        <div className="mt-2" aria-hidden="true">
          <div className="relative h-1.5 rounded-full bg-gradient-to-r from-down/50 via-muted/30 to-up/50">
            <span
              className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-ink bg-text"
              style={{ left: `${scorePos}%` }}
            />
          </div>
          <div className="flex justify-between text-label opacity-70 mt-1 font-mono tnum">
            <span>매도 −{maxScore}</span>
            <span>0</span>
            <span>매수 +{maxScore}</span>
          </div>
        </div>
        <p className="text-label opacity-70 mt-2 leading-relaxed">
          과거 가격·지표를 정해진 규칙으로 요약한 참고 정보예요. 예측이나 투자 조언이 아니며 판단과 책임은 본인에게
          있어요. 아래 패널도 모두 같은 전제예요.
        </p>
      </section>

      {cfgOpen && <ConfigSheet cfg={cfg} onApply={applyCfg} onClose={() => setCfgOpen(false)} />}

      {/* 신호 근거 — 판정 바로 아래에 둬서 왜 이런 결론인지 이어서 읽히게 한다 */}
      <Panel label="신호 근거" help="verdict">
        <ul className="space-y-2">
          {s.signals.map((it) => (
            <li key={it.name} className="flex gap-2.5 text-sm">
              <span
                className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${it.score > 0 ? 'bg-up' : it.score < 0 ? 'bg-down' : 'bg-muted'}`}
                aria-hidden="true"
              />
              <span>
                <span className="font-semibold">{it.name}</span>
                <span className="text-muted">
                  {' '}
                  — {it.detail}
                  <span className="sr-only">{it.score > 0 ? ' (매수 쪽)' : it.score < 0 ? ' (매도 쪽)' : ' (중립)'}</span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      {/* 신호 과거 성과 (미니 백테스트) */}
      {hist.data && (hist.data.buy || hist.data.sell) && (
        <Panel label="최근 1년, 이 신호의 성과" help="backtest">
          <div className="grid grid-cols-2 gap-2">
            <PerfBox label="매수 우위 후" perf={hist.data.buy} horizon={hist.data.horizon} />
            <PerfBox label="매도 우위 후" perf={hist.data.sell} horizon={hist.data.horizon} />
          </div>
          <p className="text-label text-muted mt-2">
            같은 규칙을 지난 1년에 적용 · 신호일로부터 {hist.data.horizon}거래일 뒤 기준 · 횟수가 적으면 우연일 수
            있어요
          </p>
        </Panel>
      )}

      <AiBriefingPanel t={t} />

      {/* 예상 변동 범위 */}
      {b && (
        <Panel label="예상 변동 범위 · 향후 7거래일" help="forecast">
          <dl className="forecast-grid mb-3">
            {(
              [
                ['예상 하단', b.lower_inner, fmtPct((b.lower_inner / cur - 1) * 100), 'text-down'],
                ['현재가', cur, '', ''],
                ['예상 상단', b.upper_inner, fmtPct((b.upper_inner / cur - 1) * 100), 'text-up'],
              ] as const
            ).map(([label, value, sub, tone]) => (
              <div key={label} className="forecast-cell">
                <dt className="metric-label">{label}</dt>
                <dd className="font-mono font-semibold tnum whitespace-nowrap">{fmtQuote(value, t)}</dd>
                <dd className={`font-mono text-xs tnum whitespace-nowrap ${tone}`}>{sub}</dd>
              </div>
            ))}
          </dl>
          <div className="relative h-3 rounded-full bg-surface-2 overflow-hidden" aria-hidden="true">
            <div
              className="absolute inset-y-0 bg-accent/25"
              style={{
                left: `${((b.lower_inner - b.lower_outer) / (b.upper_outer - b.lower_outer)) * 100}%`,
                right: `${((b.upper_outer - b.upper_inner) / (b.upper_outer - b.lower_outer)) * 100}%`,
              }}
            />
            <div className="absolute top-0 bottom-0 w-0.5 bg-text" style={{ left: `${pos}%` }} />
          </div>
          <div className="flex justify-between gap-3 mt-1.5 font-mono text-label tnum text-muted">
            <span className="whitespace-nowrap">
              <span className="font-sans">넓은 하단 </span>
              {fmtQuote(b.lower_outer, t)}
            </span>
            <span className="whitespace-nowrap">
              <span className="font-sans">넓은 상단 </span>
              {fmtQuote(b.upper_outer, t)}
            </span>
          </div>
          <p className="text-label text-muted mt-2">
            가운데 띠 ≈68% · 양끝 ≈95% 확률 범위 · 일간 변동성 {fc.data ? (fc.data.sigma * 100).toFixed(1) : '—'}%
            기준 · 방향 예측 아님
          </p>
        </Panel>
      )}

      {/* 참고 가격대 */}
      <Panel label="참고 가격대" help="sr">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-label text-muted font-semibold mb-1.5">지지 · 아래쪽 가격대</div>
            {s.support.length ? (
              s.support.map((x) => (
                <div key={x.label} className="flex justify-between text-xs py-0.5">
                  <span className="font-mono tnum">{fmtQuote(x.value, t)}</span>
                  <span className="text-muted">{x.label}</span>
                </div>
              ))
            ) : (
              <div className="text-label text-muted">없음</div>
            )}
          </div>
          <div>
            <div className="text-label text-muted font-semibold mb-1.5">저항 · 위쪽 가격대</div>
            {s.resistance.length ? (
              s.resistance.map((x) => (
                <div key={x.label} className="flex justify-between text-xs py-0.5">
                  <span className="font-mono tnum">{fmtQuote(x.value, t)}</span>
                  <span className="text-muted">{x.label}</span>
                </div>
              ))
            ) : (
              <div className="text-label text-muted">없음</div>
            )}
          </div>
        </div>
      </Panel>

      {RELATED_INSIGHT_TICKERS.has(t.ticker) && <RelatedInsightPanel ticker={t.ticker} />}

      <NightGapHistoryPanel ticker={t.ticker} />

      {/* 기대와 실제가 벌어지는 이유들 — 같은 6개월 기간으로 맞춰 나란히 읽히게 한다 */}
      <LeverageDecayPanel ticker={t.ticker} period="6m" />
      <FxAttributionPanel ticker={t.ticker} market={t.market} period="6m" />

      {/* 밸류에이션 참고 (주식만) */}
      {t.kind === 'stock' && val.data && (
        <Panel label="밸류에이션 참고">
          <div className="grid grid-cols-3 gap-2">
            <Metric
              label="PER"
              help="per"
              value={fmtNum(val.data.PER, 1)}
              sub={band(val.data.PER, 10, 25, ['낮음', '보통', '높음'])}
            />
            <Metric
              label="PBR"
              help="pbr"
              value={fmtNum(val.data.PBR, 2)}
              sub={band(val.data.PBR, 1, 3, ['낮음', '보통', '높음'])}
            />
            <Metric
              label="ROE"
              help="roe"
              value={val.data.ROE != null ? `${(val.data.ROE * 100).toFixed(1)}%` : '—'}
              sub={band(val.data.ROE, 0.05, 0.15, ['낮음', '보통', '우수'])}
            />
          </div>
        </Panel>
      )}
    </div>
  )
}
