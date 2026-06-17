const CACHE = 'gemma-raus-v2'
const PRECACHE = ['/index.html']

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  if (e.request.mode === 'navigate') {
    // Network-first: always fetch fresh HTML so Vite content-hashed JS/CSS refs are current.
    // Cache fallback only when offline.
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const copy = r.clone()
          caches.open(CACHE).then(c => c.put(e.request, copy))
          return r
        })
        .catch(() => caches.match('/index.html'))
    )
    return
  }
  if (!e.request.url.startsWith(self.location.origin)) return
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)))
})

// Push notifications
self.addEventListener('push', e => {
  let data = {}
  try { data = e.data.json() } catch {}

  const de = (navigator.language || 'de').startsWith('de')
  const title = de ? (data.title_de || 'Gemma Raus') : (data.title_en || 'Gemma Raus')
  const body  = de ? (data.body_de  || '') : (data.body_en  || '')

  const tag = data.type === 'rain' ? 'rain-warning' : 'rain-gap'

  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag,
      renotify: true,
      requireInteraction: false,
      silent: false,
    })
  )
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin))
      return existing ? existing.focus() : clients.openWindow('/')
    })
  )
})
