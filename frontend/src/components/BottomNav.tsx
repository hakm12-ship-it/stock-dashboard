export type TabKey = 'home' | 'signal' | 'tech' | 'fund' | 'news'

const ICONS: Record<TabKey, string> = {
  home: 'M3 11l9-7 9 7M5 10v10h14V10',
  signal: 'M3 12h4l3-8 4 16 3-8h4',
  tech: 'M5 20V11M12 20V4M19 20V14',
  fund: 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
  news: 'M6 3h9l4 4v14H6zM9 9h6M9 13h6M9 17h4',
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'home', label: '홈' },
  { key: 'signal', label: '종합' },
  { key: 'tech', label: '차트' },
  { key: 'fund', label: '가치' },
  { key: 'news', label: '뉴스' },
]

export default function BottomNav({
  active,
  onChange,
}: {
  active: TabKey
  onChange: (k: TabKey) => void
}) {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-20 border-t border-border bg-ink/90 backdrop-blur pb-safe">
      <div className="mx-auto max-w-app grid grid-cols-5">
        {TABS.map((t) => {
          const on = t.key === active
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              className="relative flex flex-col items-center gap-1 py-2.5"
            >
              {on && <span className="absolute top-0 inset-x-5 h-[2px] bg-accent rounded-full" />}
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-colors ${on ? 'text-accent' : 'text-muted'}`}
              >
                <path d={ICONS[t.key]} />
              </svg>
              <span className={`text-[0.66rem] font-medium ${on ? 'text-accent' : 'text-muted'}`}>
                {t.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
