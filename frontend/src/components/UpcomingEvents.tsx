import { useQuery } from '@tanstack/react-query'
import { getCalendar } from '../lib/api'
import { CALENDAR_QUERY_POLICY, CALENDAR_CATEGORIES, dateLabel, eventTime, koreanDate, shiftDate, sortedEvents } from '../lib/calendar'
import Icon from './Icon'

export default function UpcomingEvents({ onOpen }: { onOpen: () => void }) {
  const start = koreanDate()
  const end = shiftDate(start, 6)
  const calendar = useQuery({
    queryKey: ['calendar', start, end],
    queryFn: () => getCalendar(start, end),
    ...CALENDAR_QUERY_POLICY,
  })
  const now = Date.now()
  const events = sortedEvents(calendar.data?.events ?? []).filter((event) => !event.startAt || Date.parse(event.startAt) >= now).slice(0, 3)
  const failedSources = calendar.data?.sources.filter((source) => source.status === 'error') ?? []
  return (
    <section className="upcoming-events" aria-labelledby="upcoming-events-title">
      <div className="upcoming-heading">
        <h2 id="upcoming-events-title" className="panel-title"><Icon name="calendar" size={17} /> 다가오는 일정</h2>
        <a href="/calendar" className="text-action" onClick={(event) => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
          event.preventDefault()
          onOpen()
        }}>전체 보기</a>
      </div>
      <p className="calendar-muted">오늘부터 7일 · 한국시간 기준</p>
      {calendar.isPending ? <p className="calendar-inline-state" role="status">일정을 불러오는 중이에요.</p> : calendar.isError && !calendar.data ? (
        <div className="calendar-inline-state" role="alert">
          <p>일정을 불러오지 못했어요.</p>
          <button className="text-action" onClick={() => void calendar.refetch()}>다시 조회</button>
        </div>
      ) : (
        <>
          {(failedSources.length > 0 || calendar.isError) && <p className="calendar-source-warning" role="status">일부 일정을 확인하지 못했어요. 전체 캘린더에서 출처 상태를 확인하세요.</p>}
          {events.length > 0 ? <ul className="upcoming-list">
            {events.map((event) => <li key={event.id}>
              <span className={`calendar-dot calendar-dot-${event.category}`} aria-hidden="true" />
              <div>
                <p className="calendar-muted">{dateLabel(event.date)} · {CALENDAR_CATEGORIES[event.category]}</p>
                <a href={event.sourceUrl} target="_blank" rel="noreferrer" className="upcoming-event-title">{event.title}<Icon name="external" size={13} /></a>
                <p className="calendar-muted">{eventTime(event)}</p>
              </div>
            </li>)}
          </ul> : <p className="calendar-inline-state">{failedSources.length > 0 ? '현재 확인된 일정이 없어요. 출처가 복구되면 다시 확인해 주세요.' : '앞으로 7일간 등록된 일정이 없어요.'}</p>}
        </>
      )}
    </section>
  )
}
