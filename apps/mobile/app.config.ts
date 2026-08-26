import type { ExpoConfig } from 'expo/config'
import fs from 'node:fs'
import path from 'node:path'

const defaultApiUrl = 'http://127.0.0.1:8000'
const apiUrl = (process.env.BOKITO_API_URL ?? defaultApiUrl).replace(/\/+$/, '')

const googleServicesPath = path.join(__dirname, 'google-services.json')
const hasGoogleServices = fs.existsSync(googleServicesPath)

const easProjectId =
  process.env.EAS_PROJECT_ID ??
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
  '97e1a5d4-41da-49fc-bcb9-d64e14ec2ac4'

const config: ExpoConfig = {
  name: 'Bokito',
  slug: 'bokito-mobile',
  owner: 'bokito_ai',
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
      backgroundColor: '#101319',
    },
    ...(hasGoogleServices ? { googleServicesFile: './google-services.json' } : {}),
  },
  plugins: [
    'expo-dev-client',
    'expo-router',
    'expo-secure-store',
    [
      'expo-notifications',
      {
        color: '#0d9488',
      },
    ],
  ],
  extra: {
    apiUrl,
    eas: {
      projectId: easProjectId,
    },
  },
}

export default config
