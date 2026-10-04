export interface UsageStatus {
  scope: 'server_process'
  timezone: 'Asia/Seoul'
  api: { date: string; startedAt: string; requests: number; httpErrors: number; cacheHits: number; cacheLoads: number; cacheErrors: number; cacheHitRate: number | null; recentErrors: { path: string; status: number; at: string }[] }
  ai: { date: string; configured: boolean; limit: number; attempts: number; remaining: number; cacheHits: number; cachedResults: number; inflight: number; cooldownSeconds: number; resetsOnRestart: boolean; recentErrors: { kind: string; reason: string; at: string }[] }
}
export const AI_STATUS_LABELS: Record<string, string> = {
  not_configured: 'AI 연결 설정 없음', daily_limit: '일일 생성 한도 도달', busy: '다른 분석 진행 중',
  quota_cooldown: '제공처 요청 제한·대기', temporarily_unavailable: 'AI 연결 실패',
}
export async function getUsageStatus(): Promise<UsageStatus> {
  const response = await fetch('/api/usage-status', { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error('호출량을 확인하지 못했습니다.')
  return response.json() as Promise<UsageStatus>
}
