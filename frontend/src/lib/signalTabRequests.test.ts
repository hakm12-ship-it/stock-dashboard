import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer, type Plugin, type ViteDevServer } from 'vite'

// 신호 탭을 열 때 실제로 나가는 /api 요청을 확인한다. 화면 컴포넌트는 JSX라 node:test가 바로 읽지 못해서
// Vite SSR로 불러와 서버 렌더링하고, 브라우저에서 마운트될 때처럼 쿼리마다 옵저버를 붙인다.
// 네트워크는 쓰지 않는다 — axios 어댑터를 바꿔 요청 주소만 기록한다.

const AXIOS = 'virtual:signal-tab-axios'
const HARNESS = 'virtual:signal-tab-harness'

// 한 모듈 그래프에서 불러야 React·react-query 인스턴스가 컴포넌트와 같아진다.
const harnessPlugin = (): Plugin => ({
  name: 'signal-tab-harness',
  resolveId: (id) => (id === AXIOS || id === HARNESS ? `\0${id}` : undefined),
  load(id) {
    if (id === `\0${AXIOS}`) return "export { default } from 'axios'"
    if (id === `\0${HARNESS}`) {
      return [
        "export { createElement } from 'react'",
        "export { renderToString } from 'react-dom/server'",
        "export { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'",
        "export { cfgKey, DEFAULT_SIGNAL_CONFIG } from '/src/lib/signalConfig.ts'",
        "export { TICKERS } from '/src/data/tickers.ts'",
        "export { default as SignalView } from '/src/views/SignalView.tsx'",
      ].join('\n')
    }
  },
})

type Req = { url: string; params: Record<string, unknown> }

const cacheDir = mkdtempSync(join(tmpdir(), 'signal-tab-test-'))
let server: ViteDevServer
let h: Record<string, any>
let log: Req[] = []

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('../..', import.meta.url)),
    cacheDir,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [harnessPlugin()],
  })
  // api.ts가 axios.create()로 기본값을 복사하기 전에 어댑터를 바꿔 둔다.
  const { default: axios } = await server.ssrLoadModule(AXIOS)
  axios.defaults.adapter = async (config: { url?: string; params?: Record<string, unknown> }) => {
    log.push({ url: config.url ?? '', params: config.params ?? {} })
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config, request: {} }
  }
  h = await server.ssrLoadModule(HARNESS)
})

after(async () => {
  await server?.close()
  rmSync(cacheDir, { recursive: true, force: true })
})

const SIGNAL = {
  available: true, signals: [], total: 0, verdict: '중립', maxScore: 5, price: 100,
  support: [], resistance: [], asOf: '2026-10-30', source: 'test',
}

/** 신호 탭을 처음 열었을 때 나가는 요청 (신호 자체는 이미 받아 둔 상태라 패널이 모두 그려진다) */
async function openSignalTab(ticker: string): Promise<Req[]> {
  const t = h.TICKERS.find((x: { ticker: string }) => x.ticker === ticker)
  log = []
  const client = new h.QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })
  client.setQueryData(['signal', t.ticker, h.cfgKey(h.DEFAULT_SIGNAL_CONFIG)], SIGNAL)
  h.renderToString(h.createElement(h.QueryClientProvider, { client }, h.createElement(h.SignalView, { t })))
  // 서버 렌더링은 요청을 보내지 않는다. 컴포넌트가 정한 옵션 그대로 옵저버를 붙여 마운트를 흉내 낸다.
  const queries = client.getQueryCache().getAll()
  const stops = queries.map((q: { options: unknown }) => new h.QueryObserver(client, q.options).subscribe(() => {}))
  while (client.isFetching() > 0) await new Promise((r) => setImmediate(r))
  stops.forEach((stop: () => void) => stop())
  client.clear()
  return log
}

test('signal tab requests valuation only for stocks, which are the only tickers that show it', async () => {
  for (const t of h.TICKERS) {
    const reqs = await openSignalTab(t.ticker)
    const val = reqs.filter((r) => r.url === '/api/valuation')
    if (t.kind === 'stock') assert.deepEqual(val.map((r) => r.params), [{ market: t.market, ticker: t.ticker }])
    else assert.deepEqual(val, [], `${t.ticker} (${t.kind}) should not request /api/valuation`)
  }
})

test('signal tab requests FX attribution only for US tickers, since the backend has none for KR', async () => {
  for (const t of h.TICKERS) {
    const reqs = await openSignalTab(t.ticker)
    const fx = reqs.filter((r) => r.url === '/api/fx-attribution')
    if (t.market === 'US') assert.deepEqual(fx.map((r) => r.params), [{ ticker: t.ticker, market: 'US', period: '6m' }])
    else assert.deepEqual(fx, [], `${t.ticker} (KR) should not request /api/fx-attribution`)
  }
})

test('signal tab still loads its other panels for every ticker', async () => {
  for (const t of h.TICKERS) {
    const urls = new Set((await openSignalTab(t.ticker)).map((r) => r.url))
    for (const url of ['/api/forecast', '/api/signal-history', '/api/night-gap-history', '/api/leverage-decay']) {
      assert.ok(urls.has(url), `${t.ticker} should request ${url}`)
    }
  }
})
