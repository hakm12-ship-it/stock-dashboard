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
        <span className="text-label text-muted">현재 분석 종목</span>
        <strong>{ticker}</strong>
        <p>
          시세부터 뉴스까지,
          <br />한 종목을 여러 관점으로.
        </p>
      </div>
      <div className="nav-foot">
        한국 · 미국 시장
        <br />
        <span>Stock Insight</span>
      </div>
    </nav>
  )
}
