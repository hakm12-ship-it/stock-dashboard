import { useQuery } from '@tanstack/react-query'
import { getDailyReport } from '../lib/api'

export default function DailyReportCard() {
  const { data } = useQuery({
    queryKey: ['daily-report'],
    queryFn: getDailyReport,
    // 백엔드가 10분 캐시하므로 그보다 자주 물어볼 이유가 없다.
    staleTime: 10 * 60 * 1000,
  })
  if (!data) {
    return <div className="h-20 rounded-xl bg-surface-2 animate-pulse" />
  }
  return (
    <div className="bg-surface border border-border rounded-xl p-3.5 card-shadow">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-label font-semibold uppercase tracking-[0.08em] text-muted">
          📋 일일 리포트
        </span>
        <span className="font-mono text-label text-muted">{data.date.slice(5)}</span>
      </div>
      <p className="text-caption leading-relaxed">{data.summary}</p>
      {data.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {data.tags.map((tag) => (
            <span
              key={tag.label}
              className={`font-mono text-label px-1.5 py-0.5 rounded border ${
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
