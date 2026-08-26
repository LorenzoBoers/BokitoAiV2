import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AuthProvider } from '../src/context/AuthContext'
import { LocaleProvider } from '../src/context/LocaleContext'
import { useCopy } from '../src/context/LocaleContext'
import { ThemeProvider, useTheme } from '../src/context/ThemeContext'
import { useGatewayInvalidation } from '../src/hooks/useMessagingQueries'
import { useNotificationRouting } from '../src/lib/notification-routing'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 20_000 },
  },
})

function GatewaySync() {
  useGatewayInvalidation()
  return null
}

function RootNavigator() {
  useNotificationRouting()
  const { t } = useCopy()
  const { colors, resolved } = useTheme()

  return (
    <>
      <StatusBar style={resolved === 'light' ? 'dark' : 'light'} />
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textHeading,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="thread/[id]" options={{ title: t('thread.screenTitle') }} />
      <Stack.Screen name="notifications" options={{ title: t('notifications.title') }} />
    </Stack>
    </>
  )
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <LocaleProvider>
              <AuthProvider>
                <GatewaySync />
                <RootNavigator />
              </AuthProvider>
            </LocaleProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  )
}
