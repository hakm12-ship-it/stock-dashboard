export type IconName =
  | 'home'
  | 'signal'
  | 'tech'
  | 'fund'
  | 'news'
  | 'search'
  | 'plus'
  | 'refresh'
  | 'sun'
  | 'moon'
  | 'arrow'
  | 'wallet'
  | 'compare'
  | 'close'
  | 'settings'
  | 'external'
  | 'edit'
  | 'trash'
  | 'check'
const paths: Record<IconName, string> = {
  home: 'M3 11l9-7 9 7M5 10v10h14V10',
  signal: 'M3 12h4l3-8 4 16 3-8h4',
  tech: 'M5 20V11M12 20V4M19 20V14',
  fund: 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
  news: 'M6 3h9l4 4v14H6zM9 9h6M9 13h6M9 17h4',
  search: 'M21 21l-5-5M18 10a8 8 0 11-16 0 8 8 0 0116 0',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0114 6M18 18a8 8 0 01-14-6',
  sun: 'M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1M16 12a4 4 0 11-8 0 4 4 0 018 0',
  moon: 'M20 15A9 9 0 019 4a9 9 0 1011 11',
  arrow: 'M19 12H5M11 6l-6 6 6 6',
  wallet: 'M4 5h15v4M4 5v15h17V9H4V5zM16 13h5v4h-5z',
  compare: 'M7 4v16M17 4v16M3 8l4-4 4 4M13 16l4 4 4-4',
  close: 'M6 6l12 12M6 18L18 6',
  settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  check: 'M5 12l5 5 9-10',
}
export default function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}
