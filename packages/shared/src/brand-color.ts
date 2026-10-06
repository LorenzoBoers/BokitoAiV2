/**
 * Brand color engine shared by the dashboard and the website widget.
 *
 * A tenant may save any string. `brandPalette` always returns a complete,
 * readable token set for the requested theme:
 * - invalid input and retired defaults fall back to `DEFAULT_BRAND_HEX`
 * - achromatic seeds (white, greys, black) give a neutral palette; hue is
 *   undefined there, so no hue is ever invented
 * - chromatic seeds keep their hue; lightness is clamped per theme, chroma is
 *   capped and reduced (never channel-clipped) to stay inside sRGB
 * - button text is white or near-black; the fill is nudged until that text
 *   reaches `MIN_FG_CONTRAST`
 * - the fill reaches `MIN_SURFACE_CONTRAST` against the theme background
 * - `ink` (accent text on the page) reaches `MIN_INK_CONTRAST` on the theme bg
 */

export type Rgb = [number, number, number]
export type BrandTheme = 'light' | 'dark'

export interface BrandPalette {
  /** Normalized `#RRGGBB` the palette was built from. */
  seed: string
  /** True for white, grey and black seeds. */
  neutral: boolean
  solid: Rgb
  hover: Rgb
  pressed: Rgb
  /** Text and icons on `solid`. */
  fg: Rgb
  /** Accent text and icons on the theme background. */
  ink: Rgb
  focus: Rgb
  /** Opacity for decorative brand glows; 0 for neutral seeds. */
  glowAlpha: number
}

export const DEFAULT_BRAND_HEX = '#32BF8E'
const RETIRED_DEFAULT_HEXES = new Set(['#00FF99', '#00D986', '#0D9488'])

export const BRAND_FG_LIGHT: Rgb = [255, 255, 255]
export const BRAND_FG_DARK: Rgb = [17, 24, 39]
export const BRAND_DEFAULT_BG: Record<BrandTheme, Rgb> = {
  light: [250, 250, 249],
  dark: [18, 18, 19],
}

/** WCAG AA for UI components and bold labels. */
export const MIN_FG_CONTRAST = 3
export const MIN_INK_CONTRAST = 4.5
/** A filled button must stand out from the page, even with a pale seed. */
export const MIN_SURFACE_CONTRAST = 1.4

const ACHROMATIC_CHROMA = 0.035
const MAX_CHROMA = 0.21
const SOLID_L: Record<BrandTheme, [number, number]> = {
  light: [0.25, 0.88],
  dark: [0.55, 0.9],
}
const NEUTRAL_SOLID_L: Record<BrandTheme, number> = { light: 0.24, dark: 0.93 }
const NEUTRAL_INK_L: Record<BrandTheme, number> = { light: 0.3, dark: 0.9 }
const WHITE_FG_MAX_L = 0.78
const HOVER_STEP = 0.045
const PRESSED_STEP = 0.09
const L_MIN = 0.05
const L_MAX = 0.99

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function normalizeBrandHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim().replace(/^#/, '')
  const full = /^[0-9a-f]{3}$/i.test(raw) ? raw.replace(/./g, (c) => c + c) : raw
  if (!/^[0-9a-f]{6}$/i.test(full)) return null
  return `#${full.toUpperCase()}`
}

export function resolveBrandSeed(value: unknown): string {
  const hex = normalizeBrandHex(value)
  if (!hex || RETIRED_DEFAULT_HEXES.has(hex)) return DEFAULT_BRAND_HEX
  return hex
}

export function hexToRgb(value: unknown): Rgb | null {
  const hex = normalizeBrandHex(value)
  if (!hex) return null
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

export function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(clamp(c, 0, 255)).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

const toLinear = (c: number) => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

const fromLinear = (v: number) => {
  const s = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055
  return Math.round(clamp(s, 0, 1) * 255)
}

export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export function rgbToOklch(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const C = Math.hypot(A, B)
  const h = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360
  return [L, C, h]
}

function oklchToLinear(L: number, C: number, h: number): [number, number, number] {
  const rad = (h * Math.PI) / 180
  const a = C * Math.cos(rad)
  const b = C * Math.sin(rad)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const inGamut = (lin: [number, number, number]) => lin.every((v) => v >= -1e-4 && v <= 1 + 1e-4)

/** OKLCH to sRGB; out-of-gamut colors lose chroma at fixed L and hue. */
export function oklchToRgb([L0, C0, h]: [number, number, number]): Rgb {
  const L = clamp(L0, 0, 1)
  const C = Math.max(0, C0)
  let lin = oklchToLinear(L, C, h)
  if (!inGamut(lin)) {
    let lo = 0
    let hi = C
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(oklchToLinear(L, mid, h))) lo = mid
      else hi = mid
    }
    lin = oklchToLinear(L, lo, h)
  }
  return [fromLinear(lin[0]), fromLinear(lin[1]), fromLinear(lin[2])]
}

/** Closest lightness to `start`, moving toward `extreme`, where `ok` holds. */
function walkLightness(start: number, extreme: number, ok: (l: number) => boolean): number {
  if (ok(start)) return start
  if (!ok(extreme)) return extreme
  let fail = start
  let pass = extreme
  for (let i = 0; i < 24; i++) {
    const mid = (fail + pass) / 2
    if (ok(mid)) pass = mid
    else fail = mid
  }
  return pass
}

export function brandPalette(
  seedInput: unknown,
  theme: BrandTheme,
  bg: Rgb = BRAND_DEFAULT_BG[theme],
): BrandPalette {
  const seed = resolveBrandSeed(seedInput)
  const [seedL, seedC, seedH] = rgbToOklch(hexToRgb(seed) as Rgb)
  const neutral = seedC < ACHROMATIC_CHROMA
  const chroma = neutral ? 0 : Math.min(seedC, MAX_CHROMA)
  const hue = neutral ? 0 : seedH
  const at = (l: number) => oklchToRgb([clamp(l, L_MIN, L_MAX), chroma, hue])

  let solidL = neutral ? NEUTRAL_SOLID_L[theme] : clamp(seedL, ...SOLID_L[theme])
  solidL = walkLightness(solidL, theme === 'light' ? L_MIN : L_MAX, (l) => contrastRatio(at(l), bg) >= MIN_SURFACE_CONTRAST)
  const whiteFg = solidL <= WHITE_FG_MAX_L
  const fg = whiteFg ? BRAND_FG_LIGHT : BRAND_FG_DARK
  solidL = whiteFg
    ? walkLightness(solidL, L_MIN, (l) => contrastRatio(BRAND_FG_LIGHT, at(l)) >= MIN_FG_CONTRAST)
    : walkLightness(solidL, L_MAX, (l) => contrastRatio(BRAND_FG_DARK, at(l)) >= MIN_INK_CONTRAST)

  // Hover and pressed move away from the label color so contrast only grows.
  const away = whiteFg ? -1 : 1
  const solid = at(solidL)

  const inkStart = neutral ? NEUTRAL_INK_L[theme] : seedL
  const inkExtreme = theme === 'light' ? L_MIN : L_MAX
  const ink = at(walkLightness(inkStart, inkExtreme, (l) => contrastRatio(at(l), bg) >= MIN_INK_CONTRAST))

  return {
    seed,
    neutral,
    solid,
    hover: at(solidL + away * HOVER_STEP),
    pressed: at(solidL + away * PRESSED_STEP),
    fg,
    ink,
    focus: solid,
    glowAlpha: neutral ? 0 : theme === 'light' ? 0.08 : 0.1,
  }
}
