import { useQuery } from '@tanstack/react-query'
import { getLeverageDecay, type Period } from '../lib/api'
import { Panel } from './ui'
import { changeColor } from '../lib/format'

const pct = (v?: number) => `${(v ?? 0) >= 0 ? '+' : ''}${(v ?? 0).toFixed(1)}%`

/** 기초자산 → 단순기대 → 실제를 한 줄에 눕혀, 기대와 실제의 간극을 눈으로 보이게 한다. */
function Bar({ label, value, max, tone }: { label: string; value: number; max: number; tone: string }) {
  const w = max > 0 ? Math.min(100, (Math.abs(value) / max) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <span className="text-[0.62rem] text-muted w-[4.5rem] shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-surface-2 overflow-hidden">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${w}%` }} />
      </div>
      <span className={`font-mono text-[0.7rem] tnum w-[3.8rem] text-right ${changeColor(value)}`}>
        {pct(value)}
      </span>
    </div>
  )
}

export default function LeverageDecayPanel({ ticker, period }: { ticker: string; period: Period }) {
  const { data } = useQuery({
    queryKey: ['leverage-decay', ticker, period],
    queryFn: () => getLeverageDecay(ticker, period),
  })
  if (!data?.available) return null

  const naive = data.naiveExpected ?? 0
  const actual = data.actualReturn ?? 0
  const und = data.underlyingReturn ?? 0
  const max = Math.max(Math.abs(naive), Math.abs(actual), Math.abs(und))
  const decay = data.totalDecay ?? 0
  // 기초자산은 올랐는데 ETF는 손실 — 가장 배신감 큰 경우라 따로 짚어준다.
  const worseThanUnleveraged = und > 0 && actual < und

  return (
    <Panel label={`⚠️ 레버리지 감쇠 · ${data.leverage}배 상품`}>
      <p className="text-[0.7rem] text-muted leading-relaxed mb-3">
        {data.underlyingName}을 {data.leverage}배로 따라가는 상품이에요. 매일 재조정돼서, 기초자산이
        출렁일수록 기대보다 덜 벌어요. (최근 {data.days}거래일 · 기초 변동성{' '}
        {(data.underlyingVol ?? 0).toFixed(0)}%)
      </p>

      <div className="space-y-1.5">
        <Bar label="기초자산" value={und} max={max} tone="bg-muted/50" />
        <Bar label={`${data.leverage}배 기대`} value={naive} max={max} tone="bg-accent/50" />
        <Bar label="실제" value={actual} max={max} tone={actual >= 0 ? 'bg-up' : 'bg-down'} />
      </div>

      <div className="mt-3 pt-3 border-t border-border space-y-1">
        <div className="flex justify-between text-[0.72rem]">
          <span className="text-muted">기대 대비 손실</span>
          <span className={`font-mono font-semibold ${changeColor(decay)}`}>
            {decay.toFixed(1)}%p
          </span>
        </div>
        <div className="flex justify-between text-[0.66rem]">
          <span className="text-muted pl-2">· 복리 효과 (변동성)</span>
          <span className="font-mono text-muted">{(data.compoundingDrag ?? 0).toFixed(1)}%p</span>
        </div>
        <div className="flex justify-between text-[0.66rem]">
          <span className="text-muted pl-2">· 보수 · 추적오차</span>
          <span className="font-mono text-muted">{(data.costDrag ?? 0).toFixed(1)}%p</span>
        </div>
      </div>

      {worseThanUnleveraged && (
        <p className="text-[0.68rem] text-down leading-relaxed mt-3 bg-down/10 border border-down/30 rounded-lg px-2.5 py-2">
          기초자산은 {pct(und)}인데 이 상품은 {pct(actual)}예요 — 레버리지 없이 기초자산을 그냥
          들고 있었다면 더 나았다는 뜻입니다.
        </p>
      )}

      <p className="text-[0.6rem] text-muted mt-2">
        장기 보유일수록 감쇠가 커져요 · 참고용, 투자 권유 아님
      </p>
    </Panel>
  )
}
