import type { Market } from '../data/tickers'

// 타임존 기준 현재 요일/분 (Intl 사용, 브라우저 로컬과 무관)
function tzParts(tz: string): { wd: string; mins: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  let hour = parseInt(get('hour'), 10)
  if (hour === 24) hour = 0
  return { wd: get('weekday'), mins: hour * 60 + parseInt(get('minute'), 10) }
}

const WEEKEND = ['Sat', 'Sun']

export interface MarketStatus {
  open: boolean
  label: string
}

// 정규장 기준 (공휴일은 미반영 — 근사)
export function marketStatus(market: Market): MarketStatus {
  const tz = market === 'KR' ? 'Asia/Seoul' : 'America/New_York'
  const { wd, mins } = tzParts(tz)
  if (WEEKEND.includes(wd)) return { open: false, label: '주말 휴장' }
  const openM = market === 'KR' ? 9 * 60 : 9 * 60 + 30
  const closeM = market === 'KR' ? 15 * 60 + 30 : 16 * 60
  const open = mins >= openM && mins < closeM
  return { open, label: open ? '장중' : '장마감' }
}
