import { useState } from 'react'

const KEY = 'onboarded-v1'

const ROWS: { icon: string; title: string; text: string }[] = [
  { icon: '🏠', title: '홈', text: '지수·관심종목·내 자산을 한눈에. 카드를 누르면 상세로 이동해요.' },
  { icon: '🎯', title: '종합 신호', text: '여러 지표를 규칙으로 요약한 참고 신호 + 예상 변동 범위.' },
  { icon: '📊', title: '차트 · 가치 · 뉴스', text: '캔들차트(지지·저항선), PER·목표주가, 최신 뉴스.' },
  { icon: '💼', title: '내 자산', text: '매수가·수량을 넣으면 손익을 원화로 합산해줘요. 내 폰에만 저장돼요.' },
  { icon: '❓', title: '용어가 어려우면', text: '지표 옆 ? 버튼을 누르면 쉬운 설명이 떠요.' },
]

export default function Onboarding() {
  const [open, setOpen] = useState(() => {
    try {
      return !localStorage.getItem(KEY)
    } catch {
      return false
    }
  })
  if (!open) return null

  const close = () => {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* ignore */
    }
    setOpen(false)
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-end justify-center p-4 pb-8 fade-in">
      <div className="bg-surface border border-border rounded-2xl p-5 w-full max-w-app card-shadow">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">📈</span>
          <span className="text-lg font-bold">스톡 인사이트</span>
        </div>
        <p className="text-xs text-muted mb-4">한국·미국 주식을 한눈에 보는 개인 리서치 앱이에요.</p>

        <div className="space-y-3 mb-4">
          {ROWS.map((r) => (
            <div key={r.title} className="flex gap-3">
              <span className="text-base leading-tight shrink-0">{r.icon}</span>
              <div>
                <div className="text-sm font-semibold leading-tight">{r.title}</div>
                <div className="text-xs text-muted leading-relaxed">{r.text}</div>
              </div>
            </div>
          ))}
        </div>

        <p className="text-[0.62rem] text-muted leading-relaxed mb-4">
          ⚠️ 시세는 실시간이 아닌 지연 데이터이며, 모든 신호·추정치는 참고용 정보입니다. 투자 조언이
          아니고 판단·책임은 본인에게 있어요.
        </p>

        <button
          onClick={close}
          className="w-full bg-accent/15 border border-accent/50 text-accent rounded-xl py-3 text-sm font-semibold active:bg-accent/25"
        >
          시작하기
        </button>
      </div>
    </div>
  )
}
