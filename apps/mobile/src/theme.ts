import {
  accentMutedAlpha,
  darkColors,
  lightColors,
  radius,
  rgbaCss,
  rgbCss,
  spacing,
  type ColorScheme,
} from '@bokito/ui-tokens'

export type ColorTokens = {
  bg: string
  sidebar: string
  canvas: string
  surface: string
  elevated: string
  hover: string
  border: string
  borderLight: string
  accent: string
  accentHover: string
  accentMuted: string
  accentInk: string
  accentFg: string
  ai: string
  aiInk: string
  textHeading: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  success: string
  warning: string
  error: string
  info: string
  htmlBody: string
  htmlLink: string
}

function toTokens(scheme: ColorScheme, mutedAlpha: number): ColorTokens {
  return {
    bg: rgbCss(scheme.bg),
    sidebar: rgbCss(scheme.bg),
    canvas: rgbCss(scheme.bg),
    surface: rgbCss(scheme.bgSurface),
    elevated: rgbCss(scheme.bgElevated),
    hover: rgbCss(scheme.bgHover),
    border: rgbCss(scheme.border),
    borderLight: rgbCss(scheme.borderLight),
    accent: rgbCss(scheme.accent),
    accentHover: rgbCss(scheme.accentHover),
    accentMuted: rgbaCss(scheme.accent, mutedAlpha),
    accentInk: rgbCss(scheme.accentInk),
    accentFg: rgbCss(scheme.accentFg),
    ai: rgbCss(scheme.ai),
    aiInk: rgbCss(scheme.aiInk),
    textHeading: rgbCss(scheme.textHeading),
    textPrimary: rgbCss(scheme.textPrimary),
    textSecondary: rgbCss(scheme.textSecondary),
    textMuted: rgbCss(scheme.textMuted),
    success: rgbCss(scheme.statusSuccess),
    warning: rgbCss(scheme.statusWarning),
    error: rgbCss(scheme.statusError),
    info: rgbCss(scheme.statusInfo),
    htmlBody: rgbCss(scheme.textPrimary),
    htmlLink: rgbCss(scheme.aiInk),
  }
}

export const darkTheme = toTokens(darkColors, accentMutedAlpha.dark)
export const lightTheme = toTokens(lightColors, accentMutedAlpha.light)

/** Default palette (dark) for modules that have not switched to useTheme yet. */
export const colors = darkTheme

export { radius, spacing }

export type ThemePreference = 'light' | 'dark' | 'system'
