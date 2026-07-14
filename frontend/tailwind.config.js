/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0A0C10',
        surface: '#12151C',
        'surface-2': '#171B24',
        border: '#232833',
        text: '#E8EBF0',
        muted: '#8B94A3',
        accent: '#E0A63C',
        up: '#F23645',
        down: '#2E86FF',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans KR"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      maxWidth: { app: '560px' },
    },
  },
  plugins: [],
}
