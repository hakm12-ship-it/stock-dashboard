import { useQuery } from '@tanstack/react-query'
import { getAiBriefing } from '../lib/api'
import type { FocusTicker } from '../data/tickers'

const STANCE_STYLE: Record<string, string> = {
  강세: 'bg-up/15 border-up/50 text-up',
  약세: 'bg-down/15 border-down/50 text-down',
  중립: 'bg-surface-2 border-border text-muted',
}

export default function AiBriefingPanel({ t }: { t: FocusTicker }) {
  const { data, isLoading } = useQuery({
    queryKey: ['ai-briefing', t.market, t.ticker],
    queryFn: () => getAiBriefing(t.market, t.ticker, t.short),
    retry: false,
  })

  if (isLoading) return <div className="h-24 rounded-xl bg-surface-2 animate-pulse" />
  if (!data?.available) return null

  return (
    <div className={`rounded-xl border px-4 py-3.5 card-shadow ${STANCE_STYLE[data.stance ?? '중립']}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[0.66rem] uppercase tracking-[0.09em] opacity-70">✨ AI 브리핑</span>
        {data.stance && <span className="text-[0.68rem] font-semibold px-2 py-0.5 rounded bg-current/10">{data.stance}</span>}
      </div>
      <p className="text-[0.82rem] leading-relaxed font-medium">{data.summary}</p>
      {data.bullets && data.bullets.length > 0 && (
        <ul className="mt-2 space-y-1">
          {data.bullets.map((b, i) => (
            <li key={i} className="text-[0.72rem] opacity-80 flex gap-1.5">
              <span>·</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[0.6rem] opacity-50 mt-2">AI 생성 분석 — 참고용, 투자 권유 아님</p>
    </div>
  )
}
