import { KR_HOURS_PENDING, MARKET_CALENDAR_COVERAGE, MARKET_SCHEDULE_REVIEWED_AT, MARKET_SCHEDULE_SOURCES } from './marketSchedule.ts'

export function marketReview(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const today = `${get('year')}-${get('month')}-${get('day')}`
  const year = Number(get('year'))
  const untilYearEnd = (Date.parse(`${year + 1}-01-01T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000
  const alerts: { id: string; message: string; source: string }[] = []
  for (const market of ['KR', 'US'] as const) {
    const years: readonly number[] = MARKET_CALENDAR_COVERAGE[market]
    const label = market === 'KR' ? '한국' : '미국'
    if (!years.includes(year)) alerts.push({ id: `${market}-current`, message: `${label} ${year}년 거래일이 미등록 상태입니다. 정규장 자동 조회가 대기 중이며 수동 조회는 가능합니다.`, source: MARKET_SCHEDULE_SOURCES[market] })
    else if (untilYearEnd <= 90 && !years.includes(year + 1)) alerts.push({ id: `${market}-next`, message: `${label} ${year + 1}년 거래일 갱신이 필요합니다. 현재 등록은 ${Math.max(...years)}년까지입니다.`, source: MARKET_SCHEDULE_SOURCES[market] })
  }
  for (const date of KR_HOURS_PENDING) {
    const ahead = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000
    if (ahead >= 0 && ahead <= 60) alerts.push({ id: date, message: `${date} 한국 특별 거래시간이 미확인입니다. 거래소 공지 확인 전까지 해당일 정규장 자동 조회는 대기합니다.`, source: MARKET_SCHEDULE_SOURCES.KR })
  }
  return { today, reviewedAt: MARKET_SCHEDULE_REVIEWED_AT, alerts, coverage: MARKET_CALENDAR_COVERAGE }
}
