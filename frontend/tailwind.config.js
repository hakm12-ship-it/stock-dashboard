/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: 'rgb(var(--ink) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        text: 'rgb(var(--text) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        up: 'rgb(var(--up) / <alpha-value>)',
        down: 'rgb(var(--down) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans KR"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      // 타입 스케일 (design-system.md §2). 이게 없어서 화면마다 text-[0.62rem] 같은
      // 임의값이 17종까지 번졌다 — 8.8~11.5px 구간에만 10종이 몰려 위계가 안 읽혔다.
      // 새 UI는 반드시 아래 6단계 안에서 고를 것.
      fontSize: {
        quote: ['2rem', { lineHeight: '1.1', letterSpacing: '-0.02em' }], // 헤더 가격
        h1: ['1.5rem', { lineHeight: '1.25' }],
        h2: ['1.15rem', { lineHeight: '1.3' }],
        body: ['0.95rem', { lineHeight: '1.5' }],
        caption: ['0.8rem', { lineHeight: '1.45' }], // 보조 설명·작은 수치
        label: ['0.72rem', { lineHeight: '1.35', letterSpacing: '0.08em' }], // uppercase 라벨
      },
      maxWidth: { app: '560px' },
    },
  },
  plugins: [],
}
