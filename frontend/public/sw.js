// Cache only successful same-origin app assets. API and account endpoints stay on the network.
const CACHE = 'stock-insight-v2'
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('stock-insight-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return
  const navigation = event.request.mode === 'navigate'
  if (!navigation && !url.pathname.startsWith('/assets/') && !/\.(png|svg|webmanifest)$/.test(url.pathname)) return
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(navigation ? '/' : event.request, copy))) }
    return response
  }).catch(async () => (await caches.match(navigation ? '/' : event.request)) || new Response('오프라인입니다. 연결 후 다시 시도해 주세요.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })))
})
