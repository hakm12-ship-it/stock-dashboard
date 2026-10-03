import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Icon from '../components/Icon'
import { getAlertInvite, getCalendar, getCalendarNotificationStatus } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import type { Holding } from '../lib/holdings'
import {
  CALENDAR_QUERY_POLICY, CALENDAR_CATEGORIES, calendarTimestamp, dateLabel, eventTime, koreanDate, monthDays, monthRange,
  CALENDAR_SCOPES, CALENDAR_EARNINGS_TICKERS, calendarScopeTickers, filterCalendarEvents, calendarEventTicker, calendarTickerHref,
  shiftMonth, sortedEvents, type CalendarCategory, type CalendarEvent, type CalendarSource, type CalendarScope, type CalendarTickerView,
} from '../lib/calendar'

const categories = Object.entries(CALENDAR_CATEGORIES) as [CalendarCategory, string][]
const weekdays = ['일', '월', '화', '수', '목', '금', '토']
const scopes = Object.entries(CALENDAR_SCOPES) as [CalendarScope, string][]
type OpenCalendarTicker = (ticker: FocusTicker, view: CalendarTickerView) => void

function SourceDetails({ source }: { source: CalendarSource }) {
  const checked = calendarTimestamp(source.status === 'ok' ? source.dataAsOf : source.checkedAt)
  const next = calendarTimestamp(source.nextRefreshAt)
  return (
    <li>
      <div className="calendar-source-heading">
        <a href={source.url} target="_blank" rel="noreferrer">{source.name}<Icon name="external" size={13} /></a>
        <span className={source.status === 'error' ? 'is-error' : ''}>{source.status === 'ok' ? '확인됨' : '조회 실패'}</span>
      </div>
      {checked && <p className="calendar-source-detail">{source.status === 'ok' ? '자료 확인' : '마지막 시도'} {checked}</p>}
      {source.status === 'error' && source.message && <p className="calendar-source-detail">{source.message}</p>}
      {next && <p className="calendar-source-detail">{source.status === 'ok' ? '원문 갱신 가능' : '재시도 가능'} {next} 이후</p>}
    </li>
  )
}

function EventCard({ event, onOpenTicker }: { event: CalendarEvent; onOpenTicker: OpenCalendarTicker }) {
  const ticker = calendarEventTicker(event)
  return (
    <li className="calendar-event">
      <div className="calendar-event-time">
        <span className={`calendar-category calendar-category-${event.category}`}>{CALENDAR_CATEGORIES[event.category]}</span>
        <span>{eventTime(event)}</span>
      </div>
      <div className="calendar-event-content">
        <div className="calendar-event-meta">
          <span>{event.country === 'KR' ? '한국' : '미국'}</span>
          {event.ticker && <span>{event.ticker}</span>}
          {event.importance === 'high' && <span className="calendar-importance">주요 일정</span>}
        </div>
        <h3>{event.title}</h3>
        {event.description && <p className="calendar-event-description">{event.description}</p>}
        <div className="calendar-event-links">
          {ticker && (['tech', 'signal'] as const).map((view) => <a key={view} className="calendar-ticker-link" href={calendarTickerHref(ticker, view)} onClick={(click) => {
            if (click.ctrlKey || click.metaKey || click.shiftKey || click.altKey) return
            click.preventDefault()
            onOpenTicker(ticker, view)
          }}>{ticker.ticker} {view === 'tech' ? '차트 보기' : '종합 분석'} <Icon name="arrow" size={13} /></a>)}
          <a className="calendar-source-link" href={event.sourceUrl} target="_blank" rel="noreferrer">
            {event.source} 원문 <Icon name="external" size={13} />
          </a>
        </div>
      </div>
    </li>
  )
}

function NotificationSchedule() {
  const status = useQuery({
    queryKey: ['calendar-notification-status'], queryFn: getCalendarNotificationStatus,
    ...CALENDAR_QUERY_POLICY,
  })
  const invite = useQuery({
    queryKey: ['alert-invite'], queryFn: getAlertInvite, staleTime: 60 * 60 * 1000, refetchOnWindowFocus: false,
  })
  const active = Boolean(!status.isError && status.data?.ready && status.data.schedulerActive)
  return (
    <section className="calendar-notifications" aria-labelledby="calendar-notifications-title">
      <div className="calendar-panel-heading">
        <h2 id="calendar-notifications-title"><Icon name="news" size={18} /> 텔레그램 알림</h2>
        <span className={`calendar-status ${active ? 'is-active' : ''}`} role="status">
          {status.isPending ? '상태 확인 중' : active ? '자동 발송 중' : status.data?.enabled === false ? '발송 꺼짐' : '연결 대기'}
        </span>
      </div>
      <p className="calendar-muted">참여한 알림 그룹으로 주요 일정과 시장 요약을 보내드려요.</p>
      <dl className="calendar-schedule">
        <div><dt>시장 요약</dt><dd>{status.data?.times?.join(' · ') || '07:00 · 12:00 · 18:00'}</dd></div>
        <div><dt>내일 일정</dt><dd>매일 {status.data?.schedule?.tomorrowCalendar || '18:00'}</dd></div>
        <div><dt>발표 전 알림</dt><dd>시간이 확정된 일정 {status.data?.schedule?.eventReminderMinutes ?? 60}분 전</dd></div>
      </dl>
      <p className="calendar-muted">모두 한국시간 기준 · 시간이 미정인 일정은 사전 알림에서 제외됩니다.</p>
      {status.isError && <p className="calendar-source-warning" role="status">알림 서버 상태를 확인하지 못했어요.</p>}
      {!status.isPending && !active && !status.isError && <p className="calendar-muted">{status.data?.enabled === false ? '자동 발송이 꺼져 있어요. 일정 조회는 계속 이용할 수 있어요.' : '서버 연결과 발송 일정이 준비되면 자동 발송 상태로 바뀝니다.'}</p>}
      {invite.data?.available && invite.data.url && <a className="button button-primary calendar-join" href={invite.data.url} target="_blank" rel="noreferrer">텔레그램 그룹 참여하기 <Icon name="external" size={15} /></a>}
    </section>
  )
}

export default function CalendarView({ tickers, holdings, onOpenTicker }: {
  tickers: readonly FocusTicker[]; holdings: readonly Holding[]; onOpenTicker: OpenCalendarTicker
}) {
  const today = koreanDate()
  const [month, setMonth] = useState(() => today.slice(0, 7))
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [category, setCategory] = useState<CalendarCategory | 'all'>('all')
  const [scope, setScope] = useState<CalendarScope>('all')
  const [includeMacro, setIncludeMacro] = useState(true)
  // Keep the public calendar indexable; private views have no shared URL or
  // personalized metadata and explicitly opt out while selected.
  useEffect(() => {
    if (scope === 'all') return
    const robots = document.querySelector('meta[name="robots"]')
    const previous = robots?.getAttribute('content')
    robots?.setAttribute('content', 'noindex, nofollow')
    return () => {
      if (previous != null) robots?.setAttribute('content', previous)
      else robots?.removeAttribute('content')
    }
  }, [scope])
  const { start, end } = monthRange(month)
  const calendar = useQuery({
    queryKey: ['calendar', start, end], queryFn: () => getCalendar(start, end),
    ...CALENDAR_QUERY_POLICY,
  })
  const scopeTickers = calendarScopeTickers(scope, tickers, holdings)
  const events = sortedEvents(filterCalendarEvents(calendar.data?.events ?? [], scope, scopeTickers, includeMacro))
    .filter((event) => category === 'all' || event.category === category)
  const eventsByDay = new Map<string, CalendarEvent[]>()
  for (const event of events) {
    const daily = eventsByDay.get(event.date) ?? []
    daily.push(event)
    eventsByDay.set(event.date, daily)
  }
  const visibleDays = [...eventsByDay.entries()].filter(([date]) => !selectedDate || date === selectedDate)
  const visibleCount = visibleDays.reduce((sum, [, daily]) => sum + daily.length, 0)
  const failed = calendar.data?.sources.filter((source) => source.status === 'error') ?? []
  const changeMonth = (direction: number) => {
    setMonth((current) => shiftMonth(current, direction))
    setSelectedDate(null)
  }
  const monthTitle = `${Number(month.slice(0, 4))}년 ${Number(month.slice(5))}월`
  const chooseScope = (next: CalendarScope) => {
    setScope(next)
    setSelectedDate(null)
    if (next !== 'all' && !includeMacro && category !== 'earnings') setCategory('all')
  }

  return (
    <div className="calendar-page fade-in">
      <div className="dashboard-heading calendar-heading">
        <div>
          <p className="dashboard-eyebrow">ECONOMIC CALENDAR</p>
          <h1 tabIndex={-1}>경제 캘린더</h1>
          <p className="dashboard-description">주요 금리 결정, 경제 지표와 빅테크 실적 일정을 확인하세요.</p>
        </div>
        <div className="calendar-heading-actions">
          <span className="calendar-timezone">한국시간 KST · UTC+9</span>
          <button className="button button-quiet" onClick={() => void calendar.refetch()} disabled={calendar.isFetching}>
            {calendar.isFetching ? '조회 중…' : '일정 새로고침'}
          </button>
        </div>
      </div>
      <div className="calendar-layout">
        <div className="calendar-main">
          <section className="calendar-month" aria-labelledby="calendar-month-title">
            <div className="calendar-month-toolbar">
              <div className="calendar-month-switcher">
                <button className="icon-button" aria-label="이전 달" onClick={() => changeMonth(-1)}><Icon name="arrow" size={18} /></button>
                <h2 id="calendar-month-title" aria-live="polite">{monthTitle}</h2>
                <button className="icon-button calendar-next" aria-label="다음 달" onClick={() => changeMonth(1)}><Icon name="arrow" size={18} /></button>
              </div>
              <button className="button button-quiet" onClick={() => { setMonth(today.slice(0, 7)); setSelectedDate(today) }}>오늘</button>
            </div>
            <div className="calendar-personalization">
              <div className="calendar-filters calendar-scope-filters" role="group" aria-label="일정 대상">
                {scopes.map(([key, label]) => <button key={key} aria-pressed={scope === key} onClick={() => chooseScope(key)}>{label}</button>)}
              </div>
              {scope !== 'all' && <>
                <label className="calendar-macro-toggle">
                  <input type="checkbox" checked={includeMacro} onChange={(change) => {
                    setIncludeMacro(change.target.checked)
                    if (!change.target.checked && category !== 'earnings') setCategory('all')
                  }} />
                  금리·경제지표도 함께 보기
                </label>
                <p className="calendar-muted" role="status">{scopeTickers.length > 0
                  ? `${CALENDAR_SCOPES[scope]} 중 실적 지원 기업 ${scopeTickers.length}개를 선택했어요.`
                  : `현재 ${CALENDAR_SCOPES[scope]}에는 실적 수집 대상 기업이 없어요.`} {includeMacro ? '금리·경제지표는 공통 일정으로 포함합니다.' : '해당 종목의 실적 일정만 표시합니다.'}</p>
                <p className="calendar-muted">이 선택은 현재 기기에만 적용되며 텔레그램 공통 알림은 바뀌지 않습니다.</p>
              </>}
              <details className="calendar-coverage">
                <summary>실적은 빅테크 7개 기업만 지원 · 대상 보기</summary>
                <p>{CALENDAR_EARNINGS_TICKERS.map((ticker) => `${ticker.name} (${ticker.ticker})`).join(' · ')}. 다른 종목의 실적은 아직 지원하지 않아요.</p>
              </details>
            </div>
            <div className="calendar-filters" role="group" aria-label="일정 종류">
              <button aria-pressed={category === 'all'} onClick={() => setCategory('all')}>모든 종류</button>
              {categories.map(([key, label]) => <button key={key} aria-pressed={category === key} disabled={scope !== 'all' && !includeMacro && key !== 'earnings'} onClick={() => setCategory(key)}><span className={`calendar-dot calendar-dot-${key}`} aria-hidden="true" />{label}</button>)}
            </div>
            <div className="calendar-grid" role="group" aria-label={`${monthTitle} 날짜 선택`} aria-busy={calendar.isFetching}>
              {weekdays.map((day) => <span className="calendar-weekday" key={day} aria-hidden="true">{day}</span>)}
              {monthDays(month).map((date, index) => {
                if (!date) return <div className="calendar-blank" key={`blank-${index}`} aria-hidden="true" />
                const daily = eventsByDay.get(date) ?? []
                const dayCategories = categories.filter(([key]) => daily.some((event) => event.category === key))
                return <button key={date} className={`calendar-day ${date === today ? 'is-today' : ''}`} aria-pressed={selectedDate === date} aria-current={date === today ? 'date' : undefined} aria-label={`${dateLabel(date)}${date === today ? ', 오늘' : ''}${calendar.isPending ? ', 일정 조회 중' : `, 확인된 일정 ${daily.length}개`}`} onClick={() => setSelectedDate(date)}>
                  <span className="calendar-day-number">{Number(date.slice(-2))}</span>
                  <span className="calendar-day-dots" aria-hidden="true">{dayCategories.map(([key]) => <span key={key} className={`calendar-dot calendar-dot-${key}`} />)}</span>
                  <span className="calendar-day-count" aria-hidden="true">{daily.length > 0 ? `${daily.length}개` : ''}</span>
                </button>
              })}
            </div>
            <p className="calendar-date-note">시각이 확정된 일정은 한국시간으로 표시합니다. 시간 미정 일정은 발표 기관의 현지 날짜 기준입니다.</p>
          </section>
          <section className="calendar-agenda" aria-labelledby="calendar-agenda-title" aria-busy={calendar.isFetching}>
            <div className="calendar-agenda-heading">
              <h2 id="calendar-agenda-title">{selectedDate ? dateLabel(selectedDate) : `${monthTitle} 전체 일정`}</h2>
              {selectedDate && <button className="text-action text-action-strong" onClick={() => setSelectedDate(null)}>이달 전체 보기</button>}
            </div>
            {calendar.isPending ? <div className="calendar-empty" role="status"><div className="h-14 rounded-xl shimmer" /><p>발표 일정을 불러오고 있어요.</p></div> : calendar.isError && !calendar.data ? (
              <div className="calendar-empty" role="alert"><h3>일정을 불러오지 못했어요</h3><p>잠시 후 다시 조회해 주세요.</p><button className="button button-quiet" onClick={() => void calendar.refetch()}>다시 조회</button></div>
            ) : (
              <>
                {(failed.length > 0 || calendar.isError) && <div className="calendar-source-warning" role="status"><strong>일부 출처를 확인하지 못했어요.</strong><p>{failed.map((source) => source.name).join(', ') || '최근 일정 갱신 실패'} · 아래에는 현재 확인된 일정만 표시됩니다.</p><button className="text-action" onClick={() => void calendar.refetch()} disabled={calendar.isFetching}>{calendar.isFetching ? '조회 중…' : '다시 조회'}</button></div>}
                <p className="calendar-agenda-count" role="status">{CALENDAR_SCOPES[scope]} · {CALENDAR_CATEGORIES[category as CalendarCategory] ?? '모든 종류'} · 확인된 일정 {visibleCount}개</p>
                {visibleDays.length > 0 ? visibleDays.map(([date, daily]) => <section key={date} className="calendar-agenda-day" aria-label={dateLabel(date)}><h3 className="calendar-date-heading">{dateLabel(date)}{date === today && <span>오늘</span>}</h3><ul>{daily.map((event) => <EventCard key={event.id} event={event} onOpenTicker={onOpenTicker} />)}</ul></section>) : <div className="calendar-empty"><Icon name="calendar" size={28} /><h3>확인된 일정이 없어요</h3><p>{failed.length > 0 ? '조회하지 못한 출처에 일정이 있을 수 있어요. 잠시 후 다시 확인해 주세요.' : selectedDate ? '다른 날짜나 이달 전체 일정을 살펴보세요.' : '다른 달이나 일정 종류를 선택해 보세요.'}</p></div>}
              </>
            )}
          </section>
        </div>
        <aside className="calendar-aside" aria-label="캘린더 알림과 출처">
          <NotificationSchedule />
          <section className="calendar-sources" aria-labelledby="calendar-sources-title">
            <h2 id="calendar-sources-title">일정 출처</h2>
            <p className="calendar-muted">발표 기관과 기업의 공식 안내를 우선 확인하세요. 일정은 변경될 수 있습니다.</p>
            <p className="calendar-muted">열린 화면은 30분마다 갱신합니다. 원문 자료는 출처별 6시간 동안 보관하므로, 새로고침해도 아래 확인 시점이 유지될 수 있어요.</p>
            {calendar.data?.sources.length ? <ul>{calendar.data.sources.map((source) => <SourceDetails key={source.url} source={source} />)}</ul> : <p className="calendar-muted">일정을 불러오면 출처를 확인할 수 있어요.</p>}
            {calendar.data?.fetchedAt && calendar.data.sources.some((source) => source.status === 'ok') && <p className="calendar-updated">가장 오래된 자료 기준 {calendarTimestamp(calendar.data.fetchedAt)}</p>}
          </section>
        </aside>
      </div>
    </div>
  )
}
