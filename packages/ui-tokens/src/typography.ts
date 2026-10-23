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

/**
 * One family for the whole web UI. `display` is its own role so an accent face
 * (marketing) can replace it without touching components; today it is Geist.
 * The @fontsource-variable packages register "Geist Variable" and "Geist Mono Variable".
 */
export const fontFamily = {
  sans: 'Geist',
  display: 'Geist',
  mono: 'Geist Mono',
  /** Native still loads Inter and JetBrains Mono from @expo-google-fonts. */
  sansNative: 'Inter_400Regular',
  sansMediumNative: 'Inter_500Medium',
  sansSemiboldNative: 'Inter_600SemiBold',
  monoNative: 'JetBrainsMono_400Regular',
  cssSans: "'Geist Variable', 'Geist', system-ui, sans-serif",
  cssDisplay: "'Geist Variable', 'Geist', system-ui, sans-serif",
  cssMono: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
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

/** Utilities reference the CSS variables, not the raw family stack. `display` is reached through the title roles only. */
export const tailwindFontFamily = {
  sans: 'var(--font-sans)',
  mono: 'var(--font-mono)',
} as const

/** Letter-spacing outside the title roles: small caps labels and one-time codes. */
export const letterSpacing = {
  eyebrow: '0.01em',
  caps: '0.06em',
  code: '0.3em',
} as const

export type TitleRole = {
  fontSize: number
  lineHeight?: number
  fontWeight: 500 | 600
  letterSpacing: string
  color: 'text-heading' | 'text-muted'
}

/** Title ladder: page > dialog > section > card > eyebrow. Emitted as `.title-*` classes. */
export const titleRoles = {
  page: { fontSize: 30, lineHeight: 36, fontWeight: 600, letterSpacing: '-0.035em', color: 'text-heading' },
  dialog: { fontSize: 20, lineHeight: 28, fontWeight: 600, letterSpacing: '-0.025em', color: 'text-heading' },
  section: { fontSize: 17, lineHeight: 24, fontWeight: 600, letterSpacing: '-0.02em', color: 'text-heading' },
  card: { fontSize: 14, lineHeight: 21, fontWeight: 500, letterSpacing: 'normal', color: 'text-heading' },
  eyebrow: { fontSize: 12.5, lineHeight: 18, fontWeight: 500, letterSpacing: letterSpacing.eyebrow, color: 'text-muted' },
} as const satisfies Record<string, TitleRole>

/** Agent replies in a thread: the same sans as the UI, one step above body text. */
export const agentChatText = { fontSize: 15, lineHeight: 24, fontWeight: 400 } as const
