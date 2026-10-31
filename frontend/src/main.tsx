import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import './workspace.css'
import './dashboard.css'
import './calendar.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60 * 1000, retry: 1, refetchOnWindowFocus: false },
  },
})

// 비시세 데이터는 화면을 오갈 때도 캐시를 재사용한다. 명시적 새로고침은 언제든 가능하다.
const cacheMinutes: Record<string, number> = {
  news: 10, val: 30, profile: 1440, fpe: 60, trend: 60, target: 60, symbols: 1440,
  peers: 60, deal: 60, groups: 5, 'daily-report': 30, 'calendar': 30, 'calendar-notification-status': 30,
}
for (const [key, minutes] of Object.entries(cacheMinutes)) {
  queryClient.setQueryDefaults([key], { staleTime: minutes * 60_000, gcTime: Math.max(minutes * 60_000, 30 * 60_000) })
}

// 배포 뒤에는 예전 해시의 지연로딩 조각이 사라져 import가 실패한다. 새 index.html을 받도록 한 번 새로고침하고,
// 방금 새로고침했는데 또 실패하면(오프라인 등) 반복하지 않고 오류 안내 화면에 맡긴다.
const CHUNK_RELOAD_KEY = 'chunk-reload-at'
window.addEventListener('vite:preloadError', () => {
  try {
    const elapsed = Date.now() - Number(sessionStorage.getItem(CHUNK_RELOAD_KEY))
    if (elapsed >= 0 && elapsed < 60_000) return
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
  } catch {
    return // 기록을 남길 수 없으면 반복을 막을 수 없으니 자동 새로고침하지 않는다.
  }
  location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
)

// PWA: 서비스워커 등록 (설치형 앱)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
