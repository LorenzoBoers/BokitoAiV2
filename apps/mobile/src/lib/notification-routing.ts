import Constants, { ExecutionEnvironment } from 'expo-constants'
import { useEffect } from 'react'
import { Linking } from 'react-native'
import { router } from 'expo-router'
import type { AppNotification } from './api'
import { WEB_APP_URL } from './config'
import {
  resolveNotificationRoute,
  type NotificationData,
  type NotificationRoute,
} from './notification-path'

export { pathFromNotificationData } from './notification-path'

function isExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient
}

function stringField(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' && value ? value : undefined
}

export function routeFromAppNotification(item: AppNotification): NotificationRoute {
  return resolveNotificationRoute({
    kind: item.kind,
    signal_id: stringField(item.payload, 'signal_id'),
    decision_id: stringField(item.payload, 'decision_id'),
    agent_id: stringField(item.payload, 'agent_id'),
    contact_id: stringField(item.payload, 'contact_id'),
    platform_change_id: stringField(item.payload, 'platform_change_id'),
    trigger_id: stringField(item.payload, 'trigger_id'),
    account_id: stringField(item.payload, 'account_id'),
    channel: stringField(item.payload, 'channel'),
    folder: stringField(item.payload, 'folder'),
  })
}

export function pathFromAppNotification(item: AppNotification) {
  const route = routeFromAppNotification(item)
  return route.type === 'app' ? route.path : '/(tabs)/home'
}

export function openNotificationRoute(route: NotificationRoute) {
  if (route.type === 'web') {
    void Linking.openURL(`${WEB_APP_URL}${route.path.startsWith('/') ? route.path : `/${route.path}`}`)
    return
  }
  router.push(route.path)
}

function openFromData(data: NotificationData | undefined) {
  openNotificationRoute(resolveNotificationRoute(data))
}

/**
 * Deep-link when the user taps a push notification (foreground, background, or cold start).
 */
export function useNotificationRouting() {
  useEffect(() => {
    if (isExpoGo()) return

    let cancelled = false

    void (async () => {
      const Notifications = await import('expo-notifications')
      const last = await Notifications.getLastNotificationResponseAsync()
      if (!cancelled && last) {
        openFromData(last.notification.request.content.data as NotificationData)
      }
    })()

    let subscription: { remove: () => void } | null = null
    void import('expo-notifications').then((Notifications) => {
      if (cancelled) return
      subscription = Notifications.addNotificationResponseReceivedListener((response) => {
        openFromData(response.notification.request.content.data as NotificationData)
      })
    })

    return () => {
      cancelled = true
      subscription?.remove()
    }
  }, [])
}
