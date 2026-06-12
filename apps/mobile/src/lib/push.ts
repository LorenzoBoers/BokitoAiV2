import Constants, { ExecutionEnvironment } from 'expo-constants'
import * as Device from 'expo-device'
import { Platform } from 'react-native'
import { subscribePush } from './api'

function isExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient
}

/**
 * Register this device for push notifications and store the Expo push token
 * on the backend. Skips Expo Go (push is not supported there since SDK 53),
 * simulators, and when permission is denied.
 */
export async function registerForPush(): Promise<string | null> {
  if (isExpoGo() || !Device.isDevice) return null

  const Notifications = await import('expo-notifications')

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  })

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.DEFAULT,
    })
  }

  const { status: existing } = await Notifications.getPermissionsAsync()
  let status = existing
  if (existing !== 'granted') {
    const result = await Notifications.requestPermissionsAsync()
    status = result.status
  }
  if (status !== 'granted') return null

  try {
    const token = (await Notifications.getExpoPushTokenAsync()).data
    await subscribePush(token)
    return token
  } catch {
    return null
  }
}
