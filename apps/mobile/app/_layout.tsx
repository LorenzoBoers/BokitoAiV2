import { DarkTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native'
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts,
} from '@expo-google-fonts/inter'
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { ActivityIndicator, Text, TextInput, View } from 'react-native'

let defaultFontApplied = false

function applyDefaultFont() {
  if (defaultFontApplied) return
  defaultFontApplied = true
  const font = { fontFamily: 'Inter_400Regular' }
  for (const Comp of [Text, TextInput]) {
    const target = Comp as typeof Text & { defaultProps?: { style?: object } }
    target.defaultProps = { ...target.defaultProps, style: [font, target.defaultProps?.style] }
  }
}
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AuthProvider } from '../src/context/AuthContext'
import { LocaleProvider } from '../src/context/LocaleContext'
import { useCopy } from '../src/context/LocaleContext'
import { ThemeProvider, useTheme } from '../src/context/ThemeContext'
import { useGatewayInvalidation } from '../src/hooks/useMessagingQueries'
import { darkTheme } from '../src/theme'
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
  const navigationTheme = {
    ...DarkTheme,
    dark: resolved === 'dark',
    colors: {
      ...DarkTheme.colors,
      primary: colors.accent,
      background: colors.bg,
      card: colors.surface,
      text: colors.textHeading,
      border: colors.border,
      notification: colors.accent,
    },
  }

  return (
    <NavigationThemeProvider value={navigationTheme}>
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
      <Stack.Screen name="call/[id]" options={{ title: t('call.title'), presentation: 'modal' }} />
      </Stack>
    </NavigationThemeProvider>
  )
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    JetBrainsMono_400Regular,
  })
  if (fontsLoaded) applyDefaultFont()
  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: darkTheme.bg }}>
        <ActivityIndicator color={darkTheme.accent} />
      </View>
    )
  }
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
