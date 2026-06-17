const CACHE = 'sbz-v1'
const PRECACHE = ['/', '/index.html']

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  // Only intercept same-origin navigation requests (app shell)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.match('/index.html').then(r => r || fetch(e.request))
    )
    return
  }
  // Pass all API / tile / external requests through without caching
  if (!e.request.url.startsWith(self.location.origin)) return
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  )
})
