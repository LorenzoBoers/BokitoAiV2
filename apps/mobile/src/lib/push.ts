import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { subscribePush } from './api'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

/**
 * Register this device for push notifications and store the Expo push token
 * on the backend. No-ops on simulators or when permission is denied.
 */
export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null

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
