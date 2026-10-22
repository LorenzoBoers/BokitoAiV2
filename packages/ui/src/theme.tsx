import { createContext, useContext, useMemo, type ReactNode } from 'react'
import {
  darkColors,
  fontFamily,
  fontSize,
  lightColors,
  radius,
  spacing,
  rgbCss,
  type ColorScheme,
  type FontSizeToken,
} from '@bokito/ui-tokens/theme'

export type ColorName = keyof ColorScheme

export type UiTokens = {
  scheme: 'light' | 'dark'
  color: Record<ColorName, string>
  spacing: typeof spacing
  radius: typeof radius
  fontSize: typeof fontSize
  fontFamily: typeof fontFamily
}

const UiThemeContext = createContext<UiTokens | null>(null)

function colorMap(scheme: ColorScheme): Record<ColorName, string> {
  const out = {} as Record<ColorName, string>
  for (const key of Object.keys(scheme) as ColorName[]) {
    out[key] = rgbCss(scheme[key])
  }
  return out
}

export function UiThemeProvider({
  scheme,
  children,
}: {
  scheme: 'light' | 'dark'
  children: ReactNode
}) {
  const value = useMemo<UiTokens>(() => {
    const palette = scheme === 'light' ? lightColors : darkColors
    return {
      scheme,
      color: colorMap(palette),
      spacing,
      radius,
      fontSize,
      fontFamily,
    }
  }, [scheme])
  return <UiThemeContext.Provider value={value}>{children}</UiThemeContext.Provider>
}

export function useTokens(): UiTokens {
  const value = useContext(UiThemeContext)
  if (!value) {
    throw new Error('useTokens must be used inside UiThemeProvider')
  }
  return value
}

export type { FontSizeToken }
