/** Brand / accent tokens applied on the widget host. Theme CSS must not override these. */

export const DEFAULT_BRAND = '#0D9488'

const LEGACY_NEON = new Set(['#00FF99', '#00D986', '#00ff99', '#00d986'])

export type Rgb = { r: number; g: number; b: number }
export type BrandTheme = 'light' | 'dark'

export function parseHexColor(value: string): Rgb | null {
  const hex = value.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    }
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    }
  }
  return null
}

/** Empty or the old neon default become the current platform teal. */
export function resolveBrandSeed(color: string | null | undefined): string {
  if (!color || !color.trim()) return DEFAULT_BRAND
  const hex = color.trim().startsWith('#') ? color.trim() : `#${color.trim()}`
  if (LEGACY_NEON.has(hex) || LEGACY_NEON.has(hex.toUpperCase())) return DEFAULT_BRAND
  return hex
}

export function relativeLuminance(rgb: Rgb): number {
  const lin = (channel: number) => {
    const s = channel / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b)
}

/** Text/icon color that stays readable on the brand fill. */
export function onBrandColor(rgb: Rgb): string {
  return relativeLuminance(rgb) > 0.45 ? '#0f172a' : '#ffffff'
}

export function darkenRgb(rgb: Rgb, factor = 0.14): Rgb {
  const f = Math.max(0, Math.min(0.5, factor))
  return { r: rgb.r * (1 - f), g: rgb.g * (1 - f), b: rgb.b * (1 - f) }
}

export function lightenRgb(rgb: Rgb, factor = 0.28): Rgb {
  const f = Math.max(0, Math.min(0.9, factor))
  return {
    r: rgb.r + (255 - rgb.r) * f,
    g: rgb.g + (255 - rgb.g) * f,
    b: rgb.b + (255 - rgb.b) * f,
  }
}

export function rgbCss(rgb: Rgb): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  return `rgb(${c(rgb.r)}, ${c(rgb.g)}, ${c(rgb.b)})`
}

/**
 * Lift dark/muddy tenant colors into a readable accent for icons and rings,
 * matching the dashboard's product-safe ramp intent (without pulling OKLCH).
 */
export function productAccent(rgb: Rgb, theme: BrandTheme): Rgb {
  const lum = relativeLuminance(rgb)
  if (theme === 'dark') {
    // Dark brands vanish on dark chrome — lift until the mark reads clearly.
    if (lum < 0.28) return lightenRgb(rgb, 0.42)
    if (lum < 0.4) return lightenRgb(rgb, 0.22)
    return rgb
  }
  // Light theme: very light brands need darkening for borders/text.
  if (lum > 0.72) return darkenRgb(rgb, 0.28)
  if (lum > 0.58) return darkenRgb(rgb, 0.12)
  return rgb
}

/**
 * Icon/mark color that stays visible on the dark launcher and header avatar
 * surfaces (those are never solid brand fills).
 */
export function markColor(rgb: Rgb, theme: BrandTheme): string {
  return rgbCss(productAccent(rgb, theme))
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
  const seed = resolveBrandSeed(color)
  const parsed = rgb ?? parseHexColor(seed)
  const theme = hostTheme(host)
  const accent = parsed ? productAccent(parsed, theme) : null

  host.style.setProperty('--bk-brand', seed)
  if (accent && parsed) {
    host.style.setProperty('--bk-primary', rgbCss(accent))
    host.style.setProperty('--bk-primary-dark', rgbCss(darkenRgb(accent, 0.14)))
    host.style.setProperty(
      '--bk-primary-light',
      `rgba(${Math.round(accent.r)},${Math.round(accent.g)},${Math.round(accent.b)},0.14)`,
    )
    host.style.setProperty('--bk-on-primary', onBrandColor(accent))
    // Mark/logo color is always the lifted accent so the monkey stays readable
    // on dark launcher/header chrome even when the seed brand is muddy.
    host.style.setProperty('--bk-mark', markColor(parsed, theme))
    host.style.setProperty('--bk-launcher-icon', markColor(parsed, theme))
  } else {
    host.style.setProperty('--bk-primary', seed)
    host.style.setProperty('--bk-primary-dark', seed)
    host.style.setProperty('--bk-on-primary', '#ffffff')
    host.style.setProperty('--bk-mark', seed)
    host.style.setProperty('--bk-launcher-icon', seed)
  }
}
