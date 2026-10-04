import { useEffect, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { getPrices, getNews, getCalendar, type WatchlistData } from '../lib/api'
import { currentBriefing, getPublicBriefing, briefingTimestamp } from '../lib/publicBriefing'
import { koreanDate, shiftDate, eventTime, dateLabel } from '../lib/calendar'
import type { FocusTicker } from '../data/tickers'
import type { Holding } from '../lib/holdings'
import { myDayTickers, significantMoves, myEarnings, matchingNews, newsItemsForDay } from '../lib/myDay'
import { fmtChange, changeColor } from '../lib/format'
import { Panel } from './ui'

export default function MyDayCard({ tickers, holdings, rows, onSelect, onOpenCalendar }: {
  tickers: FocusTicker[]; holdings: Holding[]; rows: ReadonlyMap<string, WatchlistData>; onSelect: (ticker: FocusTicker) => void; onOpenCalendar: () => void
}) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const update = () => setNow(new Date())
    const id = window.setInterval(update, 60_000)
    document.addEventListener('visibilitychange', update)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', update) }
  }, [])
  const mine = myDayTickers(tickers, holdings)
  // Cache observers only: the original panels own all network requests.
  const prices = useQueries({ queries: mine.map((t) => ({ queryKey: ['prices', t.ticker, '1m'], queryFn: () => getPrices(t.ticker, '1m'), enabled: false })) })
  const news = useQueries({ queries: mine.map((t) => ({ queryKey: ['news', t.market, t.name], queryFn: () => getNews(t.market, t.name), enabled: false })) })
  const slot = currentBriefing(now), start = koreanDate(now), end = shiftDate(start, 6)
  const briefing = useQuery({ queryKey: ['public-briefing', slot.date, slot.slot], queryFn: () => getPublicBriefing(slot.date, slot.slot), enabled: false })
  const calendar = useQuery({ queryKey: ['calendar', start, end], queryFn: () => getCalendar(start, end), enabled: false })
  const cached = new Map(prices.flatMap((query, i) => query.data ? [[`${mine[i].market}:${mine[i].ticker}`, query.data] as const] : []))
  const moves = significantMoves(mine, rows, cached, now)
  const earnings = myEarnings(calendar.data?.events ?? [], mine, now)
  const headlines = matchingNews([...(briefing.data?.items ?? []), ...news.flatMap((query) => newsItemsForDay(query.data ?? []))], mine, now)
  const failedSources = calendar.data?.sources.some((source) => source.status === 'error')
  return (
    <Panel className="my-day-card">
      <div className="flex items-center justify-between gap-2"><h2 className="panel-title">내 종목 오늘의 변화</h2><span className="text-label text-muted font-mono">{start.slice(5).replace('-', '.')} KST</span></div>
      <p className="text-label text-muted mt-1">관심·보유 종목 · 홈에서 조회한 자료와 저장된 뉴스 재사용</p>
      <div className="grid gap-3 mt-3">
        <section><h3 className="text-caption font-semibold">큰 등락 <span className="text-label text-muted">최근 거래일 대비 ±3% 이상</span></h3>
          <p className="text-label text-muted mt-1">시세 확인 {moves.available}/{mine.length}종목 · 화면 필터 밖의 미조회 종목은 집계에서 제외</p>
          {moves.moves.length ? <ul className="mt-2 space-y-2">{moves.moves.map((move) => <li key={`${move.ticker.market}:${move.ticker.ticker}`}>
            <button className="w-full min-h-[44px] flex items-center justify-between gap-2 text-caption text-left" onClick={() => onSelect(move.ticker)}>
              <span>{move.ticker.short}<small className="block text-label text-muted">{move.asOf} 기준</small></span><span className={`font-mono shrink-0 ${changeColor(move.pct)}`}>{fmtChange(move.pct)} ›</span>
            </button></li>)}</ul> : <p className="text-label text-muted mt-2">{moves.available ? '확인된 시세 중 기준을 넘는 종목이 없습니다.' : '최신 시세를 확인하면 큰 등락을 표시합니다.'}</p>}
        </section>
        <section><h3 className="text-caption font-semibold">7일 내 내 종목 실적</h3>
          {earnings.length ? <ul className="mt-2 space-y-2">{earnings.map((event) => <li key={event.id}>
            <button className="text-action min-h-[44px] text-left" onClick={onOpenCalendar}>{event.title} ›</button>
            <p className="text-label text-muted">{dateLabel(event.date)} · {eventTime(event)}</p></li>)}</ul>
            : <p className="text-label text-muted mt-2">{!calendar.data ? '일정을 확인하면 내 종목 실적을 표시합니다.' : failedSources ? '확인된 실적 일정이 없습니다. 일부 출처를 조회하지 못했습니다.' : '확인된 7일 내 실적 일정이 없습니다.'}</p>}
          <p className="text-label text-muted mt-2">실적은 빅테크 7개 기업을 지원합니다.</p>
          <button className="text-action min-h-[44px]" onClick={onOpenCalendar}>전체 캘린더 보기 ›</button>
        </section>
      </div>
      <section className="mt-3 pt-3 border-t border-border"><h3 className="text-caption font-semibold">최근 24시간 관련 뉴스</h3>
        <p className="text-label text-muted mt-1">제목에 내 종목명이 언급된 기사 · 경제 브리핑과 이미 본 뉴스에서 선택</p>
        {headlines.length ? <ul className="mt-2 space-y-3">{headlines.map((item) => <li key={item.url}>
          <a className="text-caption leading-relaxed hover:text-accent break-words" href={item.url} target="_blank" rel="noreferrer">{item.title} ↗</a>
          <p className="text-label text-muted mt-1">{item.tickers.map((t) => t.short).join(' · ')} · {item.source} · {briefingTimestamp(item.publishedAt)} KST</p>
        </li>)}</ul> : <p className="text-label text-muted mt-2">현재 조회된 자료에서 연결할 기사가 없습니다. 경제 브리핑이나 종목의 관련 뉴스를 확인해 주세요.</p>}
      </section>
    </Panel>
  )
}
