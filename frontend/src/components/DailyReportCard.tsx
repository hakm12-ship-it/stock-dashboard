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
      {/* 태그 줄(KOSPI·KOSDAQ·NASDAQ·원달러·WTI)은 뺐다. 바로 아래 지수·매크로
          스트립이 같은 다섯 숫자를 이미 보여주고, 위 문장에도 또 들어 있어서
          한 화면에 같은 값이 세 번 나왔다. 응답의 tags는 그대로 두고 화면에서만
          생략한다 — 쓰는 곳이 생기면 다시 꺼내 쓸 수 있게. */}
      <p className="text-caption leading-relaxed">{data.summary}</p>
    </div>
  )
}
