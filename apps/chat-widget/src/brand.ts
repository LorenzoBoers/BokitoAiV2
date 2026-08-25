/** Brand / accent tokens applied on the widget host. Theme CSS must not override these. */

export const DEFAULT_BRAND = '#0D9488'

export type Rgb = { r: number; g: number; b: number }

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

export function rgbCss(rgb: Rgb): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  return `rgb(${c(rgb.r)}, ${c(rgb.g)}, ${c(rgb.b)})`
}

export function applyBrandToHost(host: HTMLElement, color: string, rgb: Rgb | null): void {
  const trimmed = color.trim()
  host.style.setProperty('--bk-brand', trimmed)
  host.style.setProperty('--bk-primary', trimmed)
  if (rgb) {
    host.style.setProperty('--bk-primary-dark', rgbCss(darkenRgb(rgb, 0.14)))
    host.style.setProperty('--bk-primary-light', `rgba(${Math.round(rgb.r)},${Math.round(rgb.g)},${Math.round(rgb.b)},0.14)`)
    host.style.setProperty('--bk-on-primary', onBrandColor(rgb))
  } else {
    host.style.setProperty('--bk-primary-dark', trimmed)
    host.style.setProperty('--bk-on-primary', '#ffffff')
  }
}
