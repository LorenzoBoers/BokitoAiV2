/* Bokito service worker: web push delivery + notification click routing.
   No offline caching on purpose - the dashboard is a live operational tool. */

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

function targetUrlFromPayload(data) {
  if (data.signal_id) {
    return `/communication/inbox/all/t/${data.signal_id}`
  }
  return '/communication'
}

self.addEventListener('push', (event) => {
  if (!event.data) return
  let data = {}
  try {
    data = event.data.json()
  } catch {
    data = { body: event.data.text() }
  }
  const title = data.title || 'Bokito'
  const options = {
    body: data.body || '',
    icon: '/bokito-logo.svg',
    badge: '/bokito-logo.svg',
    data: { url: targetUrlFromPayload(data) },
  }
  // Collapse repeat pushes for the same thread/decision into one notification.
  if (data.kind && (data.signal_id || data.decision_id)) {
    options.tag = `${data.kind}:${data.signal_id || data.decision_id}`
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/communication'
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client) {
            try {
              await client.navigate(url)
            } catch {
              // cross-origin or detached client; fall through to openWindow
            }
          }
          return
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})
