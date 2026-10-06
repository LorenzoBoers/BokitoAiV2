import { describe, expect, it } from 'vitest'

import {
  brandPalette,
  contrastRatio,
  hexToRgb,
  normalizeBrandHex,
  resolveBrandSeed,
  rgbToHex,
  rgbToOklch,
  BRAND_DEFAULT_BG,
  BRAND_FG_DARK,
  BRAND_FG_LIGHT,
  MIN_FG_CONTRAST,
  MIN_INK_CONTRAST,
  MIN_SURFACE_CONTRAST,
  type BrandTheme,
  type Rgb,
} from '@bokito/shared'

const THEMES: BrandTheme[] = ['light', 'dark']

const NAMED_SEEDS = [
  '#FFFFFF', '#000000', '#808080', '#F5F5F5', '#1A1A1A',
  '#FFCD00', '#FFFF00', '#00FF99', '#32BF8E', '#0F172A',
  '#FF0000', '#0000FF', '#FF00FF', '#00FFFF', '#FFF5D6',
  '#3B0764', '#7C2D12', '#415E78', '#E6F4EA', '#2B2B30',
]

function sweepSeeds(): string[] {
  const steps = [0, 51, 102, 153, 204, 255]
  const out: string[] = []
  for (const r of steps) for (const g of steps) for (const b of steps) out.push(rgbToHex([r, g, b]))
  return [...NAMED_SEEDS, ...out]
}

const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

const isGrey = ([r, g, b]: Rgb) => Math.max(r, g, b) - Math.min(r, g, b) <= 2

describe('normalizeBrandHex / resolveBrandSeed', () => {
  it('normalizes 3- and 6-digit hex with or without #', () => {
    expect(normalizeBrandHex('#0f9')).toBe('#00FF99')
    expect(normalizeBrandHex(' 32bf8e ')).toBe('#32BF8E')
    expect(hexToRgb('#00FF99')).toEqual([0, 255, 153])
  })

  it('rejects anything that is not a hex color', () => {
    for (const bad of ['', '#12', 'red', 'rgb(1,2,3)', '#GGGGGG', '#1234567', null, undefined, 42]) {
      expect(normalizeBrandHex(bad)).toBeNull()
    }
  })

  it('falls back to the mint default for invalid input and retired defaults', () => {
    for (const value of [null, '', 'not-a-color', '#00FF99', '#00d986', '#0D9488']) {
      expect(resolveBrandSeed(value)).toBe('#32BF8E')
    }
    expect(resolveBrandSeed('#112233')).toBe('#112233')
  })
})

describe('brandPalette invariants', () => {
  const seeds = sweepSeeds()

  for (const theme of THEMES) {
    it(`keeps every seed readable in ${theme} mode`, () => {
      const bg = BRAND_DEFAULT_BG[theme]
      for (const seed of seeds) {
        const p = brandPalette(seed, theme)
        const label = `${seed} ${theme}`
        expect(p.fg === BRAND_FG_LIGHT || p.fg === BRAND_FG_DARK, label).toBe(true)
        const minFg = p.fg === BRAND_FG_LIGHT ? MIN_FG_CONTRAST : MIN_INK_CONTRAST
        expect(contrastRatio(p.fg, p.solid), label).toBeGreaterThanOrEqual(minFg - 0.01)
        expect(contrastRatio(p.fg, p.hover), label).toBeGreaterThanOrEqual(minFg - 0.01)
        expect(contrastRatio(p.fg, p.pressed), label).toBeGreaterThanOrEqual(minFg - 0.01)
        expect(contrastRatio(p.ink, bg), label).toBeGreaterThanOrEqual(MIN_INK_CONTRAST - 0.01)
        expect(contrastRatio(p.solid, bg), label).toBeGreaterThanOrEqual(MIN_SURFACE_CONTRAST - 0.01)
      }
    })
  }

  it('never invents a hue for white, grey or black', () => {
    for (const seed of ['#FFFFFF', '#000000', '#808080', '#F5F5F5', '#1A1A1A', '#2B2B30']) {
      for (const theme of THEMES) {
        const p = brandPalette(seed, theme)
        expect(p.neutral, seed).toBe(true)
        expect(isGrey(p.solid), `${seed} ${theme} solid ${p.solid}`).toBe(true)
        expect(isGrey(p.ink), `${seed} ${theme} ink ${p.ink}`).toBe(true)
        expect(p.glowAlpha).toBe(0)
      }
    }
  })

  it('makes neutral buttons dark in light mode and light in dark mode', () => {
    expect(brandPalette('#FFFFFF', 'light').fg).toBe(BRAND_FG_LIGHT)
    expect(brandPalette('#FFFFFF', 'dark').fg).toBe(BRAND_FG_DARK)
  })

  it('keeps the seed hue for chromatic colors', () => {
    for (const seed of ['#FFCD00', '#00FF99', '#32BF8E', '#FF0000', '#0000FF', '#0F172A', '#7C2D12']) {
      const [, , seedH] = rgbToOklch(hexToRgb(seed)!)
      for (const theme of THEMES) {
        const p = brandPalette(seed, theme)
        expect(p.neutral, seed).toBe(false)
        const [, , h] = rgbToOklch(p.solid)
        expect(hueDistance(h, seedH), `${seed} ${theme}`).toBeLessThan(12)
      }
    }
  })

  it('puts white text on the platform mint and dark text on yellow', () => {
    for (const theme of THEMES) {
      expect(brandPalette('#32BF8E', theme).fg).toBe(BRAND_FG_LIGHT)
      expect(brandPalette('#FFCD00', theme).fg).toBe(BRAND_FG_DARK)
    }
  })

  it('treats invalid input exactly like the default', () => {
    expect(brandPalette('banana', 'light')).toEqual(brandPalette('#32BF8E', 'light'))
  })
})
