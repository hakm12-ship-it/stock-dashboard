export type BriefingSlot = 'morning' | 'noon' | 'evening'

export const BRIEFING_SLOTS: { id: BriefingSlot; label: string; hour: string }[] = [
  { id: 'morning', label: '아침', hour: '07:00' },
  { id: 'noon', label: '점심', hour: '12:00' },
  { id: 'evening', label: '저녁', hour: '18:00' },
]

export interface PublicBriefing {
  date: string
  slot: BriefingSlot
  label: string
  timezone: 'Asia/Seoul'
  scheduledAt: string
  status: 'ready' | 'not_started' | 'archive_unavailable' | 'unavailable' | 'building'
  available: boolean
  message: string
  generatedAt: string | null
  windowStart: string | null
  windowEnd: string | null
  backfillStart: string | null
  backfillCount: number
  retryAfter: number
  mode: 'rss_headlines'
  items: { id: string; title: string; source: string; url: string; publishedAt: string; previousWindow: boolean }[]
  sources: { name: string; status: 'ok' | 'partial' | 'error' }[]
}

export function briefingDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type)?.value).join('-')
}

export function currentBriefing(now = new Date()): { date: string; slot: BriefingSlot } {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', hourCycle: 'h23',
  }).format(now))
  return { date: briefingDate(now), slot: hour >= 18 ? 'evening' : hour >= 12 ? 'noon' : 'morning' }
}

export function isFutureBriefing(date: string, slot: BriefingSlot, now = new Date()): boolean {
  const hour = BRIEFING_SLOTS.find((entry) => entry.id === slot)!.hour
  return new Date(`${date}T${hour}:00+09:00`).getTime() > now.getTime()
}

export function shiftBriefingDate(value: string, days: number): string {
  const next = new Date(`${value}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

export function briefingTimestamp(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '시각 미확인'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value))
}

export async function getPublicBriefing(date: string, slot: BriefingSlot, signal?: AbortSignal): Promise<PublicBriefing> {
  const query = new URLSearchParams({ date, slot })
  const timeout = AbortSignal.timeout(30_000)
  const response = await fetch(`/api/public-briefing?${query}`, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (!response.ok) throw new Error('경제 브리핑을 불러오지 못했어요.')
  return response.json() as Promise<PublicBriefing>
}
