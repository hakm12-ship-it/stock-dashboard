import Icon from './Icon'
import { TAB_LABELS, type TabKey } from '../lib/navigation'
export type { TabKey } from '../lib/navigation'
export default function BottomNav({
  active,
  onChange,
  ticker,
}: {
  active: TabKey
  onChange: (k: TabKey) => void
  ticker: string
}) {
  return (
    <nav className="app-nav" aria-label="주요 메뉴">
      <p className="nav-caption">리서치 워크스페이스</p>
      <div className="nav-items">
        {(Object.entries(TAB_LABELS) as [TabKey, string][]).map(([key, label]) => (
          key === 'calendar' ? <a
            key={key}
            href="/calendar"
            onClick={(event) => {
              if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
              event.preventDefault()
              onChange(key)
            }}
            aria-current={active === key ? 'page' : undefined}
            className={`nav-item ${active === key ? 'is-active' : ''}`}
          ><Icon name={key} /><span>{label}</span></a> :
          <button
            key={key}
            onClick={() => onChange(key)}
            aria-current={active === key ? 'page' : undefined}
            className={`nav-item ${active === key ? 'is-active' : ''}`}
          >
            <Icon name={key} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="nav-context">
        <span className="text-label text-muted">분석 메뉴에서 볼 종목</span>
        <strong>{ticker}</strong>
      </div>
    </nav>
  )
}
