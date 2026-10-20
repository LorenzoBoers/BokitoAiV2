export type Rgb = readonly [number, number, number]

export const accentMutedAlpha: { dark: number; light: number }

export const colorTokens: Record<
  string,
  { css: string; dark: Rgb; light: Rgb }
>
