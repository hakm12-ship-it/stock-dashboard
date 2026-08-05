import type { ReactNode } from 'react'
import HelpTip from './HelpTip'

export function Panel({
  label,
  help,
  children,
  className = '',
}: {
  label?: string
  help?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`bg-surface border border-border rounded-xl p-4 card-shadow ${className}`}>
      {label && (
        <div className="text-label font-semibold uppercase tracking-[0.08em] text-muted mb-3">
          {label}
          {help && <HelpTip term={help} />}
        </div>
      )}
      {children}
    </section>
  )
}

/**
 * 전체화면 시트의 공통 껍데기 — 제목 줄 + 닫기 버튼 + 스크롤 본문.
 * 닫기 버튼의 탭 영역 확장(before:-inset-3)이 네 시트에 복붙돼 있어서
 * 한 곳만 고치면 어긋나던 걸 여기로 모았다.
 */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 bg-ink flex flex-col fade-in">
      <div className="flex items-center justify-between px-4 pt-safe pb-3 border-b border-border">
        <span className="text-base font-bold">{title}</span>
        <button
          onClick={onClose}
          aria-label="닫기"
          className="relative z-10 text-muted text-2xl leading-none px-2 active:text-text before:absolute before:-inset-3 before:content-['']"
        >
          ×
        </button>
      </div>
      <div className="px-4 py-3 space-y-3 overflow-y-auto flex-1 pb-10">{children}</div>
    </div>
  )
}

export function Metric({
  label,
  value,
  sub,
  subClass = 'text-muted',
  help,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  subClass?: string
  help?: string
}) {
  return (
    <div className="bg-surface border border-border rounded-xl px-3.5 py-3 card-shadow">
      <div className="text-label font-semibold uppercase tracking-[0.07em] text-muted">
        {label}
        {help && <HelpTip term={help} />}
      </div>
      <div className="font-mono text-lg font-semibold tnum mt-1 leading-tight truncate">{value}</div>
      {sub != null && <div className={`font-mono text-xs mt-0.5 ${subClass}`}>{sub}</div>}
    </div>
  )
}

export function Loading() {
  return (
    <div className="space-y-2 pt-1">
      <div className="h-14 rounded-xl shimmer" />
      <div className="h-40 rounded-xl shimmer" />
      <div className="h-24 rounded-xl shimmer" />
    </div>
  )
}

/** 지연로딩(lazy) 차트의 Suspense 대기 표시 — 차트 높이만큼 자리를 잡아 레이아웃이 튀지 않게 한다. */
export function ChartFallback({ height = 220 }: { height?: number }) {
  return <div className="rounded-xl shimmer" style={{ height }} />
}

export function Empty({ label = '데이터가 없어요' }: { label?: string }) {
  return <div className="text-muted text-sm py-8 text-center">{label}</div>
}

export function ErrorState({
  onRetry,
  label = '데이터를 불러오지 못했어요',
}: {
  onRetry?: () => void
  label?: string
}) {
  return (
    <div className="text-center py-8">
      <div className="text-muted text-sm">{label}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 px-4 py-1.5 rounded-lg border border-border text-sm text-text active:bg-surface-2"
        >
          다시 시도
        </button>
      )}
    </div>
  )
}
