import type { ReactNode } from 'react'

export function Panel({
  label,
  children,
  className = '',
}: {
  label?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`bg-surface border border-border rounded-xl p-4 ${className}`}>
      {label && (
        <div className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-muted mb-3">
          {label}
        </div>
      )}
      {children}
    </section>
  )
}

export function Metric({
  label,
  value,
  sub,
  subClass = 'text-muted',
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  subClass?: string
}) {
  return (
    <div className="bg-surface border border-border rounded-xl px-3.5 py-3">
      <div className="text-[0.66rem] font-semibold uppercase tracking-[0.07em] text-muted">
        {label}
      </div>
      <div className="font-mono text-xl font-semibold tnum mt-1 leading-tight">{value}</div>
      {sub != null && <div className={`font-mono text-xs mt-0.5 ${subClass}`}>{sub}</div>}
    </div>
  )
}

export function Loading({ label = '불러오는 중…' }: { label?: string }) {
  return <div className="text-muted text-sm py-10 text-center animate-pulse">{label}</div>
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
