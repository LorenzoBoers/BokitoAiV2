/**
 * Applies tenant branding (favicon + brand color) to the dashboard shell.
 * The picked hex is a seed; `brandPalette` in `@bokito/shared` turns it into
 * readable tokens, the same engine the website widget uses.
 */

import {
  brandPalette,
  normalizeBrandHex,
  resolveBrandSeed,
  DEFAULT_BRAND_HEX,
  type BrandTheme,
  type Rgb,
} from '@bokito/shared'

export const DEFAULT_BRAND_MARK = '/bokito-logo.svg'
const DEFAULT_FAVICON = DEFAULT_BRAND_MARK

/** Recolor the single-fill platform mark for the current shell theme. */
export const BOKITO_MARK_FILTER_DARK =
  'brightness(0) saturate(100%) invert(98%) sepia(2%) saturate(1312%) hue-rotate(188deg) brightness(112%) contrast(93%)'
export const BOKITO_MARK_FILTER_LIGHT =
  'brightness(0) saturate(100%) invert(20%) sepia(4%) saturate(300%) hue-rotate(20deg) brightness(95%) contrast(90%)'

export function isPlatformBrandMark(url: string | null | undefined): boolean {
  if (!url) return true
  const trimmed = url.trim().split('?')[0]?.replace(/\/+$/, '') ?? ''
  return (
    trimmed === DEFAULT_BRAND_MARK
    || trimmed.endsWith('/bokito-logo.svg')
    || trimmed.endsWith('bokito-logo.svg')
    || trimmed.endsWith('/bokito-logo-in-circel.svg')
    || trimmed.endsWith('bokito-logo-in-circel.svg')
  )
}

/** First custom branding pictogram: widget override, favicon, then logo. Null = Bokito mark. */
export function resolveBrandIconUrl(assets: {
  favicon?: string | null
  logo?: string | null
  widgetFaviconUrl?: string | null
} | null | undefined): string | null {
  if (!assets) return null
  for (const value of [assets.widgetFaviconUrl, assets.favicon, assets.logo]) {
    const trimmed = typeof value === 'string' ? value.trim() : ''
    if (trimmed && !isPlatformBrandMark(trimmed)) return trimmed
  }
  return null
}

export function workspaceBrandName(workspace: { name?: string | null } | null | undefined): string {
  const name = workspace?.name?.trim()
  return name || 'Bokito'
}

/** Platform brand seed — mint from the workspace branding picker. */
export const DEFAULT_BRAND_COLOR = DEFAULT_BRAND_HEX
export { normalizeBrandHex, resolveBrandSeed }

const BRAND_STYLE_KEYS = [
  '--color-accent',
  '--color-accent-hover',
  '--color-accent-dark',
  '--color-accent-fg',
  '--color-accent-ink',
  '--color-border-focus',
  '--body-glow-top',
  '--body-glow-bottom',
] as const

const cssRgb = (rgb: Rgb) => rgb.join(' ')
const cssRgba = (rgb: Rgb, alpha: number) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`

export function brandStyleVars(brandColor: unknown, theme: BrandTheme): Record<(typeof BRAND_STYLE_KEYS)[number], string> {
  const p = brandPalette(brandColor, theme)
  return {
    '--color-accent': cssRgb(p.solid),
    '--color-accent-hover': cssRgb(p.hover),
    '--color-accent-dark': cssRgb(p.pressed),
    '--color-accent-fg': cssRgb(p.fg),
    '--color-accent-ink': cssRgb(p.ink),
    '--color-border-focus': cssRgb(p.focus),
    '--body-glow-top': cssRgba(p.solid, p.glowAlpha * 0.8),
    '--body-glow-bottom': cssRgba(p.solid, p.glowAlpha * 0.4),
  }
}

export function applyBrandColor(brandColor: string | null | undefined, theme: BrandTheme = 'dark'): void {
  const root = document.documentElement
  const vars = brandStyleVars(brandColor, theme)
  for (const key of BRAND_STYLE_KEYS) root.style.setProperty(key, vars[key])
}


export function applyFavicon(faviconUrl: string | null | undefined): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  const next = faviconUrl || DEFAULT_FAVICON
  if (link.href !== next) {
    link.removeAttribute('type')
    link.href = next
  }
}
