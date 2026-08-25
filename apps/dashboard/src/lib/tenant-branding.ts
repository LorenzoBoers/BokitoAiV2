/**
 * Applies tenant branding (favicon + brand color) to the dashboard shell.
 *
 * The picked hex is a seed, not raw paint. We keep the hue and derive a
 * product-safe ramp (Linear / Radix style) so neon or muddy colors still
 * look modern on large fills, while text stays readable.
 */

const DEFAULT_FAVICON = '/bokito-logo.svg'

/** Platform brand seed — the teal from the default user-avatar palette. */
export const DEFAULT_BRAND_COLOR = '#0D9488'

const LEGACY_DEFAULT_BRAND_COLORS = new Set(['#00FF99', '#00D986', '#00ff99', '#00d986'])

function normalizeHex(value: string): string {
  const trimmed = value.trim()
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`
}

/** Empty or the old neon default become the current platform teal. */
export function resolveBrandSeed(brandColor: string | null | undefined): string {
  if (!brandColor || !brandColor.trim()) return DEFAULT_BRAND_COLOR
  const hex = normalizeHex(brandColor)
  if (LEGACY_DEFAULT_BRAND_COLORS.has(hex) || LEGACY_DEFAULT_BRAND_COLORS.has(hex.toUpperCase())) {
    return DEFAULT_BRAND_COLOR
  }
  return hex
}

export type Rgb = [number, number, number]
export type BrandTheme = 'light' | 'dark'
export type Oklch = [number, number, number]

export type BrandTokens = {
  accent: Rgb
  hover: Rgb
  dark: Rgb
  fg: Rgb
  ink: Rgb
  focus: Rgb
  glowTop: string
  glowBottom: string
}

const THEME_BG: Record<BrandTheme, Rgb> = {
  dark: [16, 19, 25],
  light: [247, 249, 252],
}

const FG_ON_DARK: Rgb = [255, 255, 255]
const FG_ON_LIGHT: Rgb = [17, 24, 39]
const MIN_CONTRAST = 4.5

/** Product-safe lightness / chroma per theme. Neon gets pulled into this box. */
const SOLID_RANGE: Record<BrandTheme, { l: [number, number]; c: [number, number] }> = {
  dark: { l: [0.66, 0.75], c: [0.1, 0.16] },
  light: { l: [0.52, 0.6], c: [0.12, 0.16] },
}

export function hexToRgb(hex: string): Rgb | null {
  const normalized = hex.trim().replace(/^#/, '')
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function srgbToLinear(value: number): number {
  const s = value / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(value: number): number {
  const s = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055
  return Math.round(clamp(s * 255, 0, 255))
}

function rgbToOklab([r, g, b]: Rgb): [number, number, number] {
  const lr = srgbToLinear(r)
  const lg = srgbToLinear(g)
  const lb = srgbToLinear(b)
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb
  const l_ = Math.cbrt(l)
  const m_ = Math.cbrt(m)
  const s_ = Math.cbrt(s)
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ]
}

function oklabToRgb([L, a, b]: [number, number, number]): Rgb {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  return [
    linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

export function rgbToOklch(rgb: Rgb): Oklch {
  const [L, a, b] = rgbToOklab(rgb)
  const C = Math.sqrt(a * a + b * b)
  const h = C < 1e-8 ? 0 : (Math.atan2(b, a) * 180) / Math.PI
  return [L, C, h < 0 ? h + 360 : h]
}

export function oklchToRgb([L, C, h]: Oklch): Rgb {
  const rad = (h * Math.PI) / 180
  return oklabToRgb([L, C * Math.cos(rad), C * Math.sin(rad)])
}

function channelLuminance(value: number): number {
  const s = value / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * channelLuminance(rgb[0]) + 0.7152 * channelLuminance(rgb[1]) + 0.0722 * channelLuminance(rgb[2])
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const light = Math.max(relativeLuminance(a), relativeLuminance(b))
  const dark = Math.min(relativeLuminance(a), relativeLuminance(b))
  return (light + 0.05) / (dark + 0.05)
}

export function pickAccentFg(fill: Rgb): Rgb {
  return contrastRatio(FG_ON_DARK, fill) >= contrastRatio(FG_ON_LIGHT, fill) ? FG_ON_DARK : FG_ON_LIGHT
}

function shiftLightness(rgb: Rgb, delta: number): Rgb {
  const [L, C, h] = rgbToOklch(rgb)
  return oklchToRgb([clamp(L + delta, 0.18, 0.92), C, h])
}

/** Same hue, chroma and lightness pulled into a product-safe range. */
export function productSolid(fill: Rgb, theme: BrandTheme): Rgb {
  const [L, C, h] = rgbToOklch(fill)
  const spec = SOLID_RANGE[theme]
  const chroma = C < 0.02 ? spec.c[0] : clamp(C, spec.c[0], spec.c[1])
  return oklchToRgb([clamp(L, spec.l[0], spec.l[1]), chroma, h])
}

/** Same-hue ink that meets 4.5:1 against the theme background. */
export function contrastInk(fill: Rgb, theme: BrandTheme, bg: Rgb = THEME_BG[theme]): Rgb {
  if (contrastRatio(fill, bg) >= MIN_CONTRAST) return fill
  const [L, C, h] = rgbToOklch(fill)
  const towardDark = theme === 'light'
  let low = towardDark ? 0.18 : L
  let high = towardDark ? L : 0.9
  let best = oklchToRgb([towardDark ? 0.18 : 0.9, C, h])
  for (let i = 0; i < 18; i += 1) {
    const mid = (low + high) / 2
    const candidate = oklchToRgb([mid, C, h])
    if (contrastRatio(candidate, bg) >= MIN_CONTRAST) {
      best = candidate
      if (towardDark) low = mid
      else high = mid
    } else if (towardDark) {
      high = mid
    } else {
      low = mid
    }
  }
  return best
}

function cssRgb(rgb: Rgb): string {
  return rgb.join(' ')
}

function cssRgba(rgb: Rgb, alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}

export function buildBrandTokens(fill: Rgb, theme: BrandTheme): BrandTokens {
  const accent = productSolid(fill, theme)
  const hover = shiftLightness(accent, theme === 'light' ? -0.04 : 0.045)
  const dark = shiftLightness(accent, theme === 'light' ? -0.1 : -0.08)
  return {
    accent,
    hover,
    dark,
    fg: pickAccentFg(accent),
    ink: contrastInk(accent, theme),
    focus: accent,
    glowTop: cssRgba(accent, theme === 'dark' ? 0.07 : 0.08),
    glowBottom: cssRgba(accent, theme === 'dark' ? 0.03 : 0.035),
  }
}

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

export function applyBrandColor(
  brandColor: string | null | undefined,
  theme: BrandTheme = 'dark',
): void {
  const root = document.documentElement
  const rgb = hexToRgb(resolveBrandSeed(brandColor))
  if (!rgb) {
    for (const key of BRAND_STYLE_KEYS) root.style.removeProperty(key)
    return
  }
  const tokens = buildBrandTokens(rgb, theme)
  root.style.setProperty('--color-accent', cssRgb(tokens.accent))
  root.style.setProperty('--color-accent-hover', cssRgb(tokens.hover))
  root.style.setProperty('--color-accent-dark', cssRgb(tokens.dark))
  root.style.setProperty('--color-accent-fg', cssRgb(tokens.fg))
  root.style.setProperty('--color-accent-ink', cssRgb(tokens.ink))
  root.style.setProperty('--color-border-focus', cssRgb(tokens.focus))
  root.style.setProperty('--body-glow-top', tokens.glowTop)
  root.style.setProperty('--body-glow-bottom', tokens.glowBottom)
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
