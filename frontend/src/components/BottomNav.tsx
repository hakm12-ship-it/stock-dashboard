export type TabKey = 'signal' | 'tech' | 'fund' | 'news'

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'signal', label: '종합', icon: '🎯' },
  { key: 'tech', label: '차트', icon: '📊' },
  { key: 'fund', label: '가치', icon: '💰' },
  { key: 'news', label: '뉴스', icon: '📰' },
]

export default function BottomNav({
  active,
  onChange,
}: {
  active: TabKey
  onChange: (k: TabKey) => void
}) {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-20 border-t border-border bg-ink/90 backdrop-blur">
      <div className="mx-auto max-w-app grid grid-cols-4">
        {TABS.map((t) => {
          const on = t.key === active
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              className="flex flex-col items-center gap-0.5 py-2.5"
            >
              <span className={`text-lg leading-none ${on ? '' : 'grayscale opacity-50'}`}>
                {t.icon}
              </span>
              <span className={`text-[0.68rem] font-medium ${on ? 'text-accent' : 'text-muted'}`}>
                {t.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
