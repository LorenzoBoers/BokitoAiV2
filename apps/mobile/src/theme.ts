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

export const darkColors: ColorTokens = {
  bg: '#101319',
  sidebar: '#14171f',
  canvas: '#161a22',
  surface: '#1d202b',
  elevated: '#242835',
  hover: '#2d313f',
  border: '#323847',
  borderLight: '#464c5c',
  accent: '#0d9488',
  accentHover: '#10a89b',
  accentMuted: 'rgba(13,148,136,0.16)',
  accentInk: '#5ed6c9',
  accentFg: '#ffffff',
  ai: '#0d9488',
  aiInk: '#5ed6c9',
  textHeading: '#f4f7fb',
  textPrimary: '#e0e4eb',
  textSecondary: '#afb5c6',
  textMuted: '#828796',
  success: '#2fbe87',
  warning: '#e89e27',
  error: '#e2585c',
  info: '#588eff',
  htmlBody: '#e0e4eb',
  htmlLink: '#5ed6c9',
}

export const lightColors: ColorTokens = {
  bg: '#f7f9fc',
  sidebar: '#f4f6fa',
  canvas: '#fcfdff',
  surface: '#ffffff',
  elevated: '#f8fafd',
  hover: '#f1f4fa',
  border: '#e4e9f2',
  borderLight: '#d0d8e6',
  accent: '#0d9488',
  accentHover: '#0b7f75',
  accentMuted: 'rgba(13,148,136,0.12)',
  accentInk: '#0b8076',
  accentFg: '#ffffff',
  ai: '#0d9488',
  aiInk: '#0b8076',
  textHeading: '#111827',
  textPrimary: '#23324a',
  textSecondary: '#5f6c8a',
  textMuted: '#7a88a5',
  success: '#16a371',
  warning: '#d97706',
  error: '#dc2626',
  info: '#2563eb',
  htmlBody: '#23324a',
  htmlLink: '#0b8076',
}

/** Default palette (dark) for modules that have not switched to useTheme yet. */
export const colors = darkColors

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
}

export const radius = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  pill: 999,
}

export type ThemePreference = 'light' | 'dark' | 'system'
