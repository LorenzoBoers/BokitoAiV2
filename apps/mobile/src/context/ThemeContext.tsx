import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Appearance, StyleSheet } from 'react-native'
import { UiThemeProvider } from '@bokito/ui'
import { darkTheme, lightTheme, type ColorTokens, type ThemePreference } from '../theme'
import { loadThemePreference, saveThemePreference } from '../lib/storage'

type ThemeState = {
  colors: ColorTokens
  preference: ThemePreference
  resolved: 'light' | 'dark'
  setPreference: (next: ThemePreference) => void
}

const ThemeContext = createContext<ThemeState | null>(null)

export function systemColorScheme(): 'light' | 'dark' {
  return Appearance.getColorScheme() === 'light' ? 'light' : 'dark'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('dark')
  const [system, setSystem] = useState<'light' | 'dark'>(systemColorScheme)

  useEffect(() => {
    void loadThemePreference().then((stored) => {
      if (stored) setPreferenceState(stored)
    })
  }, [])

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystem(colorScheme === 'light' ? 'light' : 'dark')
    })
    return () => sub.remove()
  }, [])

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    void saveThemePreference(next)
  }, [])

  const resolved: 'light' | 'dark' = preference === 'system' ? system : preference

  const value = useMemo<ThemeState>(
    () => ({
      colors: resolved === 'light' ? lightTheme : darkTheme,
      preference,
      resolved,
      setPreference,
    }),
    [preference, resolved, setPreference],
  )

  return (
    <UiThemeProvider scheme={resolved}>
      <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
    </UiThemeProvider>
  )
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

export function useThemedStyles(
  factory: (colors: ColorTokens) => Record<string, object>,
): ReturnType<typeof StyleSheet.create> {
  const { colors } = useTheme()
  return useMemo(
    () => StyleSheet.create(factory(colors) as StyleSheet.NamedStyles<Record<string, object>>),
    [colors, factory],
  )
}
