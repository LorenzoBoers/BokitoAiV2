/** Matches the Tailwind fontSize ladder in apps/dashboard/tailwind.config.ts. */

export type TypeStep = {
  fontSize: number
  lineHeight: number
  letterSpacing?: number
}

export const fontSize = {
  '2xs': { fontSize: 11.5, lineHeight: 15 },
  xs: { fontSize: 13, lineHeight: 19 },
  sm: { fontSize: 14, lineHeight: 21 },
  base: { fontSize: 15, lineHeight: 23 },
  lg: { fontSize: 16, lineHeight: 25 },
  xl: { fontSize: 19, lineHeight: 27, letterSpacing: -0.19 },
  '2xl': { fontSize: 24, lineHeight: 31, letterSpacing: -0.36 },
} as const satisfies Record<string, TypeStep>

export type FontSizeToken = keyof typeof fontSize

export const fontFamily = {
  sans: 'Inter',
  serif: 'Source Serif 4',
  mono: 'JetBrains Mono',
  /** Loaded names from @expo-google-fonts. */
  sansNative: 'Inter_400Regular',
  sansMediumNative: 'Inter_500Medium',
  sansSemiboldNative: 'Inter_600SemiBold',
  monoNative: 'JetBrainsMono_400Regular',
  cssSans: "'Inter', system-ui, sans-serif",
  cssSerif: "'Source Serif 4', Georgia, serif",
  cssMono: "'JetBrains Mono', ui-monospace, monospace",
} as const

/**
 * Tailwind `fontSize` tuples: the px ladder above divided by 16. Native keeps `fontSize` in px.
 * Editorial steps are web-only.
 */
export const webFontSize = {
  '2xs': ['0.71875rem', { lineHeight: '0.9375rem' }],
  xs: ['0.8125rem', { lineHeight: '1.1875rem' }],
  sm: ['0.875rem', { lineHeight: '1.3125rem' }],
  base: ['0.9375rem', { lineHeight: '1.4375rem' }],
  lg: ['1rem', { lineHeight: '1.5625rem' }],
  xl: ['1.1875rem', { lineHeight: '1.6875rem', letterSpacing: '-0.01em' }],
  '2xl': ['1.5rem', { lineHeight: '1.9375rem', letterSpacing: '-0.015em' }],
  'docs-nav': ['0.8125rem', { lineHeight: '1.25rem' }],
  'docs-body': ['1.0625rem', { lineHeight: '1.75rem' }],
  'docs-h2': ['1.65rem', { lineHeight: '2.125rem', letterSpacing: '-0.015em' }],
  display: ['2.75rem', { lineHeight: '1.15', letterSpacing: '-0.02em' }],
} as const

/** Utilities reference the CSS variables, not the raw family stack. */
export const tailwindFontFamily = {
  sans: 'var(--font-sans)',
  serif: 'var(--font-serif)',
  mono: 'var(--font-mono)',
} as const
