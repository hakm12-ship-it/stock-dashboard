import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createElement, type ComponentType } from 'react'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createServer, type ViteDevServer } from 'vite'
import type { FocusTicker } from '../data/tickers.ts'
import type { NewsItem } from './api.ts'

// NewsView는 .tsx라 node:test가 바로 못 읽는다. vite를 네트워크 없이(미들웨어 모드, ws·watch 끔)
// 띄워 SSR로 불러온 뒤 서버 렌더링해서, 첫 렌더에서 sessionStorage를 어떻게 다루는지 본다.
type NewsViewProps = { t: FocusTicker; tickers: FocusTicker[] }

const samsung: FocusTicker = { ticker: '005930', name: '삼성전자', short: '삼성전자', market: 'KR', kind: 'stock' }
const hynix: FocusTicker = { ticker: '000660', name: 'SK하이닉스', short: 'SK하이닉스', market: 'KR', kind: 'stock' }
const news: NewsItem[] = [{ title: '삼성전자 테스트 기사', link: 'https://example.invalid/a', source: '테스트', published: '2026-01-02 09:00' }]

let server: ViteDevServer
let NewsView: ComponentType<NewsViewProps>

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('../..', import.meta.url)),
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  NewsView = ((await server.ssrLoadModule('/src/views/NewsView.tsx')) as { default: ComponentType<NewsViewProps> }).default
})

after(async () => {
  await server?.close()
})

function withSessionStorage<T>(getter: () => unknown, run: () => T): T {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: getter })
  try {
    return run()
  } finally {
    if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous)
    else Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
}

function render(): string {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(['news', samsung.market, samsung.name], news)
  client.setQueryData(['news', hynix.market, hynix.name], [])
  return renderToString(createElement(QueryClientProvider, { client }, createElement(NewsView, { t: samsung, tickers: [samsung, hynix] })))
}

test('news tab still renders the single-ticker feed when the browser blocks sessionStorage', () => {
  // 사이트 데이터를 막은 브라우저는 window.sessionStorage에 접근하는 순간 SecurityError를 던진다.
  const html = withSessionStorage(() => {
    throw new DOMException('The operation is insecure.', 'SecurityError')
  }, render)
  assert.match(html, /<button aria-pressed="true">삼성전자 뉴스<\/button>/)
  assert.match(html, /<button aria-pressed="false">관심종목 전체<\/button>/)
  assert.ok(html.includes('삼성전자 테스트 기사'))
})

test('news tab still restores the saved all-watchlist scope when sessionStorage works', () => {
  const stored = new Map([['newsMode', 'all']])
  const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) }
  const html = withSessionStorage(() => storage, render)
  assert.match(html, /<button aria-pressed="true">관심종목 전체<\/button>/)
  assert.match(html, /<button aria-pressed="false">삼성전자 뉴스<\/button>/)
})
