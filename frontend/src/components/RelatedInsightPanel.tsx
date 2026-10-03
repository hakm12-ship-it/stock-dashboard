import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRelatedInsight } from '../lib/api'
import { fmtChange, changeColor } from '../lib/format'

export default function RelatedInsightPanel({ ticker }: { ticker: string }) {
  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ['related-insight', ticker],
    queryFn: () => getRelatedInsight(ticker),
    enabled: false,
    retry: false,
    // 백엔드가 LLM 문구를 30분 캐시한다 (등락률은 그때 함께 갱신).
    staleTime: 30 * 60 * 1000,
  })

  const [all, setAll] = useState(false)
  if (!data?.available) return (
    <section className="bg-surface border border-border rounded-xl p-4">
      <h2 className="panel-title">관련 종목 흐름</h2>
      <p className="text-label text-muted mt-2" role="status">
        {isError || data ? '관련 종목 분석을 가져오지 못했습니다. 잠시 후 다시 요청해 주세요.' : '버튼을 누르면 관련 종목의 시세와 AI 요약을 함께 확인합니다.'}
      </p>
      <button className="button button-quiet mt-2" disabled={isFetching} onClick={() => void refetch()}>
        {isFetching ? '관련 종목 분석 중…' : '관련 종목 AI 분석 요청'}
      </button>
    </section>
  )

  return (
    <section className="bg-surface border border-border rounded-xl p-4 card-shadow">
      <h2 className="panel-title">관련 종목 흐름</h2>
      {data.insight && <p className="text-caption leading-relaxed mt-1.5">{data.insight}</p>}
      {!data.insight && <p className="text-label text-muted mt-2">AI 요약을 받지 못해 관련 종목 시세만 표시합니다.</p>}
      {data.stocks && data.stocks.length > 0 && (
        <div className="mt-2 divide-y divide-border">
          {(all ? data.stocks : data.stocks.slice(0, 4)).map((s) => (
            <div key={s.ticker} className="flex items-center justify-between py-1.5 gap-2">
              <div className="min-w-0">
                <div className="text-caption font-medium truncate">{s.name}</div>
                <div className="text-label text-muted truncate">{s.role}</div>
              </div>
              {s.changePct != null ? (
                <span className={`font-mono text-caption font-semibold shrink-0 ${changeColor(s.changePct)}`}>
                  {fmtChange(s.changePct)}
                </span>
              ) : (
                <span className="text-label text-muted shrink-0">—</span>
              )}
            </div>
          ))}
        </div>
      )}
      {data.stocks && data.stocks.length > 4 && (
        <button onClick={() => setAll((v) => !v)} aria-expanded={all} className="text-action w-full justify-center">
          {all ? '4개만 보기' : `관련 종목 ${data.stocks.length - 4}개 더 보기`}
        </button>
      )}
      <p className="text-label text-muted mt-1">
        AI 생성 요약 — 참고용, 투자 권유 아님
        {data.stale && ' · 새 요약을 못 받아 직전 요약을 보여주고 있어요 (등락률은 최신)'}
      </p>
      <button className="button button-quiet mt-2" disabled={isFetching} onClick={() => void refetch()}>
        {isFetching ? '관련 종목 분석 중…' : '관련 종목 AI 분석 다시 확인'}
      </button>
      {isError && <p className="text-label text-muted mt-2" role="status">연결하지 못해 이전 결과를 표시합니다.</p>}
    </section>
  )
}
