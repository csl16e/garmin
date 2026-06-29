const CACHE = 'garmin-v1'
const OFFLINE_URLS = [
  '/garmin/',
  '/garmin/index.html',
  '/garmin/garmin/data.json'
]

// Install: cache the shell + data
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(OFFLINE_URLS)).then(() => self.skipWaiting())
  )
})

// Activate: drop old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

// Fetch: network first, fall back to cache
self.addEventListener('fetch', e => {
  // Only handle same-origin GET requests
  if (e.request.method !== 'GET') return
  if (!e.request.url.startsWith(self.location.origin)) return

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Update cache with fresh response
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, clone))
        }
        return res
      })
      .catch(() => caches.match(e.request).then(cached => cached || caches.match('/garmin/')))
  )
})
