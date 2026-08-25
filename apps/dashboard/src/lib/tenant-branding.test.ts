import { describe, expect, it } from 'vitest'

import {
  DEFAULT_BRAND_COLOR,
  buildBrandTokens,
  contrastInk,
  contrastRatio,
  hexToRgb,
  pickAccentFg,
  productSolid,
  relativeLuminance,
  resolveBrandSeed,
  rgbToOklch,
} from './tenant-branding'

const WHITE: [number, number, number] = [255, 255, 255]
const NEAR_BLACK: [number, number, number] = [17, 24, 39]
const LIGHT_BG: [number, number, number] = [247, 249, 252]
const DARK_BG: [number, number, number] = [16, 19, 25]
const NEON: [number, number, number] = [0, 255, 153]
const NAVY: [number, number, number] = [15, 23, 42]

describe('resolveBrandSeed', () => {
  it('uses the teal platform default when empty or the old neon seed', () => {
    expect(DEFAULT_BRAND_COLOR).toBe('#0D9488')
    expect(resolveBrandSeed(null)).toBe('#0D9488')
    expect(resolveBrandSeed('')).toBe('#0D9488')
    expect(resolveBrandSeed('#00FF99')).toBe('#0D9488')
    expect(resolveBrandSeed('#00d986')).toBe('#0D9488')
  })

  it('keeps a tenant-chosen hex', () => {
    expect(resolveBrandSeed('#112233')).toBe('#112233')
  })
})

describe('hexToRgb', () => {
  it('parses 6-digit and 3-digit hex', () => {
    expect(hexToRgb('#00FF99')).toEqual([0, 255, 153])
    expect(hexToRgb('00ff99')).toEqual([0, 255, 153])
    expect(hexToRgb('#0f9')).toEqual([0, 255, 153])
  })

  it('rejects invalid values', () => {
    expect(hexToRgb('')).toBeNull()
    expect(hexToRgb('#12')).toBeNull()
    expect(hexToRgb('not-a-color')).toBeNull()
  })
})

describe('contrast helpers', () => {
  it('gives white a luminance of 1 and black near 0', () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5)
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 5)
  })

  it('reports high contrast for black on white', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeGreaterThan(20)
  })
})

describe('pickAccentFg', () => {
  it('puts dark text on neon green fills', () => {
    expect(pickAccentFg(NEON)).toEqual(NEAR_BLACK)
  })

  it('puts light text on navy fills', () => {
    expect(pickAccentFg(NAVY)).toEqual(WHITE)
  })
})

describe('contrastInk', () => {
  it('darkens neon green in light mode until it meets 4.5:1', () => {
    const ink = contrastInk(NEON, 'light', LIGHT_BG)
    expect(contrastRatio(ink, LIGHT_BG)).toBeGreaterThanOrEqual(4.5)
    expect(ink[1]).toBeLessThan(255)
  })

  it('keeps or lightens neon green in dark mode', () => {
    const ink = contrastInk(NEON, 'dark', DARK_BG)
    expect(contrastRatio(ink, DARK_BG)).toBeGreaterThanOrEqual(4.5)
    expect(relativeLuminance(ink)).toBeGreaterThanOrEqual(relativeLuminance(NEON) - 0.01)
  })

  it('leaves an already-readable navy unchanged on the light canvas', () => {
    expect(contrastInk(NAVY, 'light', LIGHT_BG)).toEqual(NAVY)
  })
})

describe('productSolid', () => {
  it('pulls neon green into a calmer, still-green fill', () => {
    const solid = productSolid(NEON, 'dark')
    const raw = rgbToOklch(NEON)
    const next = rgbToOklch(solid)
    expect(next[0]).toBeLessThan(raw[0])
    expect(next[1]).toBeLessThan(raw[1])
    expect(next[2]).toBeGreaterThan(140)
    expect(next[2]).toBeLessThan(180)
  })

  it('lifts navy so buttons stay visible in dark mode', () => {
    const solid = productSolid(NAVY, 'dark')
    expect(relativeLuminance(solid)).toBeGreaterThan(relativeLuminance(NAVY))
    expect(pickAccentFg(solid)).toEqual(NEAR_BLACK)
  })
})

describe('buildBrandTokens', () => {
  it('uses the refined fill for buttons and a readable ink', () => {
    const tokens = buildBrandTokens(NEON, 'light')
    expect(tokens.accent).toEqual(productSolid(NEON, 'light'))
    expect(contrastRatio(tokens.ink, LIGHT_BG)).toBeGreaterThanOrEqual(4.5)
    expect(tokens.glowTop.startsWith('rgba(')).toBe(true)
  })
})
