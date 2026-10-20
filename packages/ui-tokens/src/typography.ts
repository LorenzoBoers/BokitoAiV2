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
