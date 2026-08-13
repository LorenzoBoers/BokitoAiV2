import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AuthProvider } from '../src/context/AuthContext'
import { useGatewayInvalidation } from '../src/hooks/useMessagingQueries'
import { useNotificationRouting } from '../src/lib/notification-routing'
import { colors } from '../src/theme'

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

  return (
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
      <Stack.Screen name="thread/[id]" options={{ title: 'Thread' }} />
    </Stack>
  )
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <GatewaySync />
            <StatusBar style="light" />
            <RootNavigator />
          </AuthProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  )
}
