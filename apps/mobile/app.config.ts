import type { ExpoConfig } from 'expo/config'
import fs from 'node:fs'
import path from 'node:path'

const defaultApiUrl = 'http://127.0.0.1:8000'
const apiUrl = (process.env.BOKITO_API_URL ?? defaultApiUrl).replace(/\/+$/, '')

const googleServicesPath = path.join(__dirname, 'google-services.json')
const hasGoogleServices = fs.existsSync(googleServicesPath)

const config: ExpoConfig = {
  name: 'Bokito',
  slug: 'bokito-mobile',
  version: '0.1.0',
  scheme: 'bokito',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'ai.bokito.mobile',
  },
  android: {
    package: 'ai.bokito.mobile',
    adaptiveIcon: {
      backgroundColor: '#0b0f1a',
    },
    ...(hasGoogleServices ? { googleServicesFile: './google-services.json' } : {}),
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-notifications',
      {
        color: '#6e66ff',
      },
    ],
  ],
  extra: {
    apiUrl,
    eas: {
      projectId: process.env.EAS_PROJECT_ID ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
    },
  },
}

export default config
