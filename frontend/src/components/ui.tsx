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
        <div className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-muted mb-3">
          {label}
          {help && <HelpTip term={help} />}
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
      <div className="text-[0.66rem] font-semibold uppercase tracking-[0.07em] text-muted">
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
