/**
 * Brand / accent tokens applied on the widget host. Theme CSS must not override these.
 * Tokens come from `brandPalette` in `@bokito/shared`, the same engine as the dashboard.
 */

import {
  brandPalette,
  hexToRgb,
  normalizeBrandHex,
  resolveBrandSeed,
  rgbToHex,
  DEFAULT_BRAND_HEX,
  type BrandTheme,
  type Rgb as RgbTuple,
} from '@bokito/shared'

export const DEFAULT_BRAND = DEFAULT_BRAND_HEX
export { resolveBrandSeed }
export type { BrandTheme }

export type Rgb = { r: number; g: number; b: number }

const WIDGET_BG: Record<BrandTheme, RgbTuple> = {
  light: [247, 248, 250],
  dark: [16, 19, 26],
}

export function parseHexColor(value: string): Rgb | null {
  const rgb = hexToRgb(value)
  return rgb ? { r: rgb[0], g: rgb[1], b: rgb[2] } : null
}

const css = (rgb: RgbTuple) => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`

export type WidgetBrandTokens = Record<
  '--bk-brand' | '--bk-primary' | '--bk-primary-dark' | '--bk-primary-light' | '--bk-on-primary' | '--bk-mark' | '--bk-launcher-icon',
  string
>

export function widgetBrandTokens(color: unknown, theme: BrandTheme): WidgetBrandTokens {
  const p = brandPalette(color, theme, WIDGET_BG[theme])
  return {
    '--bk-brand': css(p.solid),
    '--bk-primary': css(p.solid),
    '--bk-primary-dark': css(p.pressed),
    '--bk-primary-light': `rgba(${p.solid[0]},${p.solid[1]},${p.solid[2]},0.14)`,
    '--bk-on-primary': css(p.fg),
    '--bk-mark': css(p.ink),
    // Light launcher is a solid fill; dark launcher is a tinted surface.
    '--bk-launcher-icon': css(theme === 'light' ? p.fg : p.ink),
  }
}

function hostTheme(host: HTMLElement): BrandTheme {
  const attr = host.getAttribute('data-theme')
  if (attr === 'light' || attr === 'dark') return attr
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

export function applyBrandToHost(host: HTMLElement, color: string, rgb: Rgb | null): void {
  const seed = normalizeBrandHex(color) ?? (rgb ? rgbToHex([rgb.r, rgb.g, rgb.b]) : null)
  const tokens = widgetBrandTokens(seed, hostTheme(host))
  for (const [key, value] of Object.entries(tokens)) host.style.setProperty(key, value)
}
