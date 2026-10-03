import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BRIEFING_SLOTS, briefingDate, briefingTimestamp, currentBriefing, getPublicBriefing, isFutureBriefing, shiftBriefingDate,
} from '../lib/publicBriefing'
import Icon from './Icon'
import { Panel } from './ui'

export default function PublicBriefingCard() {
  const [selection, setSelection] = useState(() => currentBriefing())
  const headingId = useId()
  const today = briefingDate()
  const earliest = shiftBriefingDate(today, -6)
  const query = useQuery({
    queryKey: ['public-briefing', selection.date, selection.slot],
    queryFn: ({ signal }) => getPublicBriefing(selection.date, selection.slot, signal),
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: false,
  })
  const result = query.data
  const failed = result?.sources.filter((source) => source.status !== 'ok') ?? []
  const refresh = () => void query.refetch()

  return (
    <Panel className="public-briefing">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={headingId} className="panel-title">경제 브리핑</h2>
          <p className="text-label text-muted mt-1">하루 세 시간대 · 주요 경제·주식 뉴스</p>
        </div>
        <button type="button" className="text-action min-h-[44px] shrink-0" disabled={query.isFetching} onClick={refresh}>
          {query.isFetching ? '조회 중' : '다시 조회'}
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 my-3">
        <input
          type="date" aria-label="경제 브리핑 날짜" value={selection.date} min={earliest} max={today}
          className="min-w-0 min-h-[44px] rounded-lg border border-border bg-surface-2 px-2 text-caption"
          onChange={(event) => {
            const value = event.target.value
            if (value >= earliest && value <= today) setSelection((old) => ({ ...old, date: value }))
          }}
        />
        <button type="button" className="text-action min-h-[44px] shrink-0" onClick={() => setSelection(currentBriefing())}>
          현재 시간대
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1" role="group" aria-label="브리핑 시간대 (한국시간)">
        {BRIEFING_SLOTS.map((slot) => (
          <button
            type="button" key={slot.id} aria-pressed={selection.slot === slot.id}
            disabled={isFutureBriefing(selection.date, slot.id)}
            onClick={() => setSelection((old) => ({ ...old, slot: slot.id }))}
            className={`min-h-[48px] rounded-md px-2 py-1 text-caption border disabled:opacity-50 disabled:cursor-not-allowed ${selection.slot === slot.id ? 'border-accent bg-surface text-accent' : 'border-transparent text-muted'}`}
          >
            <span className="block font-medium">{slot.label}</span>
            <span className="block text-label font-mono">{slot.hour}</span>
          </button>
        ))}
      </div>

      <div aria-labelledby={headingId} aria-busy={query.isFetching}>
        {query.isPending ? (
          <p className="text-caption text-muted py-5" role="status">출처에서 발행시각이 확인된 기사를 모으고 있어요.</p>
        ) : query.isError && !result ? (
          <div className="text-caption text-muted py-5" role="alert">
            <p>경제 브리핑을 불러오지 못했어요.</p>
            <button type="button" className="text-action min-h-[44px]" onClick={refresh}>다시 시도</button>
          </div>
        ) : result ? (
          <>
            {query.isError && <p className="text-label text-muted mt-3" role="status">새 응답을 받지 못해 마지막으로 확인한 브리핑을 표시합니다.</p>}
            {result.available ? (
              <>
                <div className="text-label text-muted mt-3 space-y-1">
                  <p>수집 구간: {briefingTimestamp(result.windowStart)} ~ {briefingTimestamp(result.windowEnd)} (KST)</p>
                  <p>확인 시각: {briefingTimestamp(result.generatedAt)} · {result.items.length}건</p>
                  {result.backfillCount > 0 && <p>해당 구간의 기사가 적어 최근 24시간 기사 {result.backfillCount}건을 함께 모았어요.</p>}
                </div>
                <ol className="divide-y divide-border mt-2">
                  {result.items.map((item, index) => (
                    <li key={item.id} className="py-3">
                      <a href={item.url} target="_blank" rel="noreferrer" className="flex items-start gap-2 text-caption font-medium leading-relaxed hover:text-accent">
                        <span className="text-muted font-mono shrink-0" aria-hidden="true">{index + 1}.</span>
                        <span className="min-w-0 break-words">{item.title}<span className="inline-flex ml-1 align-middle"><Icon name="external" size={12} /></span></span>
                      </a>
                      <p className="text-label text-muted mt-1 pl-5">
                        {item.source} · <time dateTime={item.publishedAt}>발행 {briefingTimestamp(item.publishedAt)} KST</time>
                        {item.previousWindow && ' · 이전 시간대'}
                      </p>
                    </li>
                  ))}
                </ol>
                <p className="text-label text-muted mt-2">{result.message}</p>
              </>
            ) : (
              <div className="text-caption text-muted py-5" role="status">
                <p>{result.message}</p>
                {result.status === 'unavailable' && result.retryAfter > 0 && <p className="text-label mt-2">약 {Math.max(1, Math.ceil(result.retryAfter / 60))}분 뒤 다시 확인해 주세요.</p>}
                {result.status === 'archive_unavailable' && <button type="button" className="text-action min-h-[44px]" onClick={() => setSelection(currentBriefing())}>현재 브리핑 보기</button>}
              </div>
            )}
            {failed.length > 0 && (
              <p className="text-label text-muted border border-border rounded-lg p-2 mt-3" role="status">
                일부 출처를 확인하지 못했어요: {failed.map((source) => `${source.name}${source.status === 'partial' ? '(일부)' : ''}`).join(', ')}.
                {result.available && ' 확인된 기사만 표시합니다.'}
              </p>
            )}
            {result.sources.length > 0 && (
              <details className="text-label text-muted mt-3">
                <summary className="cursor-pointer min-h-[32px]">출처 확인 상태 · {result.sources.length}곳</summary>
                <ul className="space-y-1 pb-1">
                  {result.sources.map((source) => <li key={source.name}>{source.name} · {source.status === 'ok' ? '확인됨' : source.status === 'partial' ? '일부 확인됨' : '조회 실패'}</li>)}
                </ul>
              </details>
            )}
          </>
        ) : null}
      </div>

      <p className="text-label text-muted mt-3 leading-relaxed">
        방문하거나 다시 조회할 때 현재 시간대의 기사를 수집해요. 정시에 자동 생성하지 않으며, 서버가 재시작하면 이전 기록이 없어질 수 있어요.
      </p>
    </Panel>
  )
}
