import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Appearance, StyleSheet, useColorScheme } from 'react-native'
import { darkColors, lightColors, type ColorTokens, type ThemePreference } from '../theme'
import { loadThemePreference, saveThemePreference } from '../lib/storage'

type ThemeState = {
  colors: ColorTokens
  preference: ThemePreference
  resolved: 'light' | 'dark'
  setPreference: (next: ThemePreference) => void
}

const ThemeContext = createContext<ThemeState | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme()
  const [preference, setPreferenceState] = useState<ThemePreference>('system')

  useEffect(() => {
    void loadThemePreference().then((stored) => {
      if (stored) setPreferenceState(stored)
    })
  }, [])

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    void saveThemePreference(next)
  }, [])

  const resolved: 'light' | 'dark' =
    preference === 'system' ? (system === 'light' ? 'light' : 'dark') : preference

  const value = useMemo<ThemeState>(
    () => ({
      colors: resolved === 'light' ? lightColors : darkColors,
      preference,
      resolved,
      setPreference,
    }),
    [preference, resolved, setPreference],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

export function useThemedStyles(
  factory: (colors: ColorTokens) => Record<string, object>,
  // StyleSheet.create contextual typing is lost once styles live in a factory.
): ReturnType<typeof StyleSheet.create> {
  const { colors } = useTheme()
  return useMemo(
    () => StyleSheet.create(factory(colors) as StyleSheet.NamedStyles<Record<string, object>>),
    [colors, factory],
  )
}

export function systemColorScheme(): 'light' | 'dark' {
  return Appearance.getColorScheme() === 'light' ? 'light' : 'dark'
}
