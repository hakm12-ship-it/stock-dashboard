// 스톡 인사이트 서비스워커 — 앱 셸 캐시(설치형 PWA), API는 항상 네트워크
const CACHE = 'stock-insight-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  // 데이터(API)는 캐시하지 않고 항상 네트워크
  if (url.pathname.startsWith('/api/')) return
  if (e.request.method !== 'GET') return

  // 앱 셸: 네트워크 우선 + 성공 시 캐시, 실패 시 캐시 폴백
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {})
        return res
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/'))),
  )
})
