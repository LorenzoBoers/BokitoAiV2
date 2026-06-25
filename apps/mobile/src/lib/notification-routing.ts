import { useEffect } from 'react'
import { router } from 'expo-router'

type NotificationData = {
  signal_id?: string
  decision_id?: string
  kind?: string
}

function routeFromNotificationData(data: NotificationData | undefined) {
  if (!data) return
  if (data.signal_id) {
    router.push(`/thread/${data.signal_id}`)
    return
  }
  if (data.decision_id) {
    router.push('/(tabs)/decisions')
  }
}

/**
 * Deep-link when the user taps a push notification (foreground, background, or cold start).
 */
export function useNotificationRouting() {
  useEffect(() => {
    let cancelled = false

    void (async () => {
      const Notifications = await import('expo-notifications')
      const last = await Notifications.getLastNotificationResponseAsync()
      if (!cancelled && last) {
        routeFromNotificationData(last.notification.request.content.data as NotificationData)
      }
    })()

    let subscription: { remove: () => void } | null = null
    void import('expo-notifications').then((Notifications) => {
      if (cancelled) return
      subscription = Notifications.addNotificationResponseReceivedListener((response) => {
        routeFromNotificationData(response.notification.request.content.data as NotificationData)
      })
    })

    return () => {
      cancelled = true
      subscription?.remove()
    }
  }, [])
}
