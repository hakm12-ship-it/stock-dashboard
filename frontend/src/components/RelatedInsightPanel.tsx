import { useQuery } from '@tanstack/react-query'
import { getRelatedInsight } from '../lib/api'
import { changeColor, changeSign } from '../lib/format'

export default function RelatedInsightPanel({ ticker }: { ticker: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['related-insight', ticker],
    queryFn: () => getRelatedInsight(ticker),
    retry: false,
    // 백엔드가 LLM 문구를 30분 캐시한다 (등락률은 그때 함께 갱신).
    staleTime: 30 * 60 * 1000,
  })

  if (isLoading) return <div className="h-32 rounded-xl bg-surface-2 animate-pulse" />
  if (!data?.available) return null

  return (
    <div className="bg-surface border border-border rounded-xl p-3.5 card-shadow">
      <span className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-muted">
        🔗 실시간 시사점
      </span>
      {data.insight && <p className="text-[0.8rem] leading-relaxed mt-1.5">{data.insight}</p>}
      {data.stocks && data.stocks.length > 0 && (
        <div className="mt-2 divide-y divide-border">
          {data.stocks.map((s) => (
            <div key={s.ticker} className="flex items-center justify-between py-1.5 gap-2">
              <div className="min-w-0">
                <div className="text-[0.78rem] font-medium truncate">{s.name}</div>
                <div className="text-[0.64rem] text-muted truncate">{s.role}</div>
              </div>
              {s.changePct != null ? (
                <span className={`font-mono text-[0.78rem] font-semibold shrink-0 ${changeColor(s.changePct)}`}>
                  {changeSign(s.changePct)} {Math.abs(s.changePct).toFixed(2)}%
                </span>
              ) : (
                <span className="text-[0.7rem] text-muted shrink-0">—</span>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-[0.6rem] text-muted mt-2">
        AI 생성 요약 — 참고용, 투자 권유 아님
        {data.stale && ' · 새 요약을 못 받아 직전 요약을 보여주고 있어요 (등락률은 최신)'}
      </p>
    </div>
  )
}
