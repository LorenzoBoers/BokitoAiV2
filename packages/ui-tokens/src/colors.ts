import { accentMutedAlpha, colorTokens } from './palette.mjs'

export type Rgb = readonly [number, number, number]

export type ColorName = keyof typeof colorTokens

export type ColorScheme = Record<ColorName, Rgb>

function scheme(mode: 'dark' | 'light'): ColorScheme {
  const out = {} as ColorScheme
  for (const name of Object.keys(colorTokens) as ColorName[]) {
    out[name] = colorTokens[name][mode]
  }
  return out
}

export const darkColors: ColorScheme = scheme('dark')
export const lightColors: ColorScheme = scheme('light')

export const cssVarName: Record<ColorName, string> = Object.fromEntries(
  (Object.keys(colorTokens) as ColorName[]).map((name) => [name, colorTokens[name].css]),
) as Record<ColorName, string>

export function rgbCss(rgb: Rgb): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
}

export function rgbaCss(rgb: Rgb, alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}

export function hexCss(rgb: Rgb): string {
  const part = (n: number) => n.toString(16).padStart(2, '0')
  return `#${part(rgb[0])}${part(rgb[1])}${part(rgb[2])}`
}

export { accentMutedAlpha, colorTokens }
