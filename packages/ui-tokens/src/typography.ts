/** Matches the Tailwind fontSize ladder in apps/dashboard/tailwind.config.ts. */

export type TypeStep = {
  fontSize: number
  lineHeight: number
  letterSpacing?: number
}

export const fontSize = {
  '2xs': { fontSize: 10.5, lineHeight: 14 },
  xs: { fontSize: 11.5, lineHeight: 16 },
  sm: { fontSize: 12.5, lineHeight: 18 },
  base: { fontSize: 13.5, lineHeight: 20 },
  lg: { fontSize: 15, lineHeight: 22 },
  xl: { fontSize: 17, lineHeight: 24, letterSpacing: -0.17 },
  '2xl': { fontSize: 20, lineHeight: 28, letterSpacing: -0.3 },
} as const satisfies Record<string, TypeStep>

export type FontSizeToken = keyof typeof fontSize

export const fontFamily = {
  sans: 'Inter',
  mono: 'JetBrains Mono',
  /** Loaded names from @expo-google-fonts. */
  sansNative: 'Inter_400Regular',
  sansMediumNative: 'Inter_500Medium',
  sansSemiboldNative: 'Inter_600SemiBold',
  monoNative: 'JetBrainsMono_400Regular',
  cssSans: "'Inter', system-ui, sans-serif",
  cssMono: "'JetBrains Mono', ui-monospace, monospace",
} as const

/**
 * Tailwind `fontSize` tuples. Native keeps `fontSize` in px.
 * `xl` is rounded to 1.063rem; `docs-body` stays the exact 1.0625rem for the same 17px.
 * Editorial steps are web-only.
 */
export const webFontSize = {
  '2xs': ['0.656rem', { lineHeight: '0.875rem' }],
  xs: ['0.719rem', { lineHeight: '1rem' }],
  sm: ['0.781rem', { lineHeight: '1.125rem' }],
  base: ['0.844rem', { lineHeight: '1.25rem' }],
  lg: ['0.938rem', { lineHeight: '1.375rem' }],
  xl: ['1.063rem', { lineHeight: '1.5rem', letterSpacing: '-0.01em' }],
  '2xl': ['1.25rem', { lineHeight: '1.75rem', letterSpacing: '-0.015em' }],
  'docs-nav': ['0.8125rem', { lineHeight: '1.25rem' }],
  'docs-body': ['1.0625rem', { lineHeight: '1.75rem' }],
  'docs-h2': ['1.65rem', { lineHeight: '2.125rem', letterSpacing: '-0.015em' }],
  display: ['2.75rem', { lineHeight: '1.15', letterSpacing: '-0.02em' }],
} as const

/** Utilities reference the CSS variables, not the raw family stack. */
export const tailwindFontFamily = {
  sans: 'var(--font-sans)',
  mono: 'var(--font-mono)',
} as const
