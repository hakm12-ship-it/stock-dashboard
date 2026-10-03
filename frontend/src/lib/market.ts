import type { Market } from '../data/tickers.ts'
import { KR_HOLIDAYS, KR_HOURS_PENDING, MARKET_CALENDAR_COVERAGE, US_EARLY_CLOSES, US_HOLIDAYS } from './marketSchedule.ts'

// 타임존 기준 현재 요일/분 (Intl 사용, 브라우저 로컬과 무관)
function tzParts(tz: string, now: Date): { wd: string; mins: number; date: string; year: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  let hour = parseInt(get('hour'), 10)
  if (hour === 24) hour = 0
  return { wd: get('weekday'), mins: hour * 60 + parseInt(get('minute'), 10), date: `${get('year')}-${get('month')}-${get('day')}`, year: Number(get('year')) }
}

const WEEKEND = ['Sat', 'Sun']

export interface MarketStatus {
  open: boolean
  label: string
  detail?: string
  uncertain?: boolean
}

// 정규장 일정 기준. 실시간 거래정지 피드가 아니며 미확인 일정에서는 자동 조회하지 않는다.
export function marketStatus(market: Market, now = new Date()): MarketStatus {
  if (!Number.isFinite(now.getTime())) return { open: false, label: '거래시간 확인 필요', uncertain: true }
  const tz = market === 'KR' ? 'Asia/Seoul' : 'America/New_York'
  const { wd, mins, date, year } = tzParts(tz, now)
  if (WEEKEND.includes(wd)) return { open: false, label: '주말 휴장' }
  const covered: readonly number[] = MARKET_CALENDAR_COVERAGE[market]
  if (!covered.includes(year)) return {
    open: false, label: '거래일 확인 필요', uncertain: true, detail: '해당 연도의 거래소 일정이 아직 등록되지 않았습니다. 수동 새로고침을 이용해 주세요.',
  }
  const holiday = market === 'KR' ? KR_HOLIDAYS[date] : US_HOLIDAYS.has(date) ? '미국 공휴일' : undefined
  if (holiday) return { open: false, label: '휴장', detail: holiday }
  if (market === 'KR' && KR_HOURS_PENDING.has(date)) return {
    open: false, label: '거래시간 확인 필요', uncertain: true, detail: '특별 거래일입니다. 거래소의 변경 시간 공지를 확인해 주세요. 자동 새로고침은 대기합니다.',
  }
  const early = market === 'US' && US_EARLY_CLOSES.has(date)
  const openM = market === 'KR' ? 9 * 60 : 9 * 60 + 30
  const closeM = market === 'KR' ? 15 * 60 + 30 : early ? 13 * 60 : 16 * 60
  const open = mins >= openM && mins < closeM
  return {
    open,
    label: open ? (early ? '장중 · 조기마감 예정' : '장중') : mins < openM ? '개장 전' : early ? '조기마감' : '장마감',
    detail: early ? '미국 동부시간 13:00 정규장 종료' : undefined,
  }
}
