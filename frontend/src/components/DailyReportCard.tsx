import { useQuery } from '@tanstack/react-query'
import { getDailyReport } from '../lib/api'

export default function DailyReportCard() {
  const { data } = useQuery({ queryKey: ['daily-report'], queryFn: getDailyReport })
  if (!data) {
    return <div className="h-20 rounded-xl bg-surface-2 animate-pulse" />
  }
  return (
    <div className="bg-surface border border-border rounded-xl p-3.5 card-shadow">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-muted">
          📋 일일 리포트
        </span>
        <span className="font-mono text-[0.62rem] text-muted">{data.date.slice(5)}</span>
      </div>
      <p className="text-[0.8rem] leading-relaxed">{data.summary}</p>
      {data.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {data.tags.map((tag) => (
            <span
              key={tag.label}
              className={`font-mono text-[0.62rem] px-1.5 py-0.5 rounded border ${
                tag.pct >= 0 ? 'border-up/40 text-up' : 'border-down/40 text-down'
              }`}
            >
              {tag.label} {tag.pct >= 0 ? '+' : ''}
              {tag.pct.toFixed(2)}%
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
