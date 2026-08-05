import { useQuery } from '@tanstack/react-query'
import { getAlertInvite } from '../lib/api'

/**
 * 텔레그램 알림 그룹 초대.
 *
 * 링크는 서버 환경변수에만 있어서, 설정 전이면 카드 자체가 나타나지 않는다.
 * 무엇을 받게 되는지 먼저 말하고 버튼을 마지막에 둔다 — 누를 이유가 없으면
 * 버튼만 있어봐야 안 누른다.
 */
export default function AlertInviteCard() {
  const { data } = useQuery({
    queryKey: ['alert-invite'],
    queryFn: getAlertInvite,
    staleTime: 60 * 60 * 1000,
  })
  if (!data?.available || !data.url) return null

  return (
    <div className="bg-surface border border-border rounded-xl p-3.5 card-shadow">
      <div className="text-label font-semibold uppercase tracking-[0.08em] text-muted">
        ✈️ 급변 알림 받기
      </div>
      <p className="text-caption text-muted leading-relaxed mt-1.5">
        큰 움직임이 있을 때만 텔레그램으로 알려드려요.
      </p>
      <ul className="text-label text-muted mt-2 space-y-1">
        <li>· 삼성전자·SK하이닉스가 5% 단위로 움직일 때</li>
        <li>· 사이드카·서킷브레이커 조건에 닿을 때</li>
        <li>· 장 마감 뒤 야간 시세가 크게 벌어질 때</li>
      </ul>
      <a
        href={data.url}
        target="_blank"
        rel="noreferrer"
        className="mt-3 flex items-center justify-center min-h-[44px] rounded-lg border border-border text-caption font-medium active:border-accent active:bg-surface-2 transition-colors"
      >
        텔레그램 그룹 참여하기
      </a>
      <p className="text-label text-muted/70 mt-2">
        참고용 정보이고 투자 권유가 아니에요 · 언제든 그룹을 나가면 알림이 멈춰요
      </p>
    </div>
  )
}
