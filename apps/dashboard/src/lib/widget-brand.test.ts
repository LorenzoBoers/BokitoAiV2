import { describe, expect, it } from 'vitest'
import {
  markColor,
  onBrandColor,
  parseHexColor,
  productAccent,
  relativeLuminance,
  resolveBrandSeed,
} from '../../../chat-widget/src/brand'

describe('widget brand contrast', () => {
  it('parses 6-digit hex', () => {
    expect(parseHexColor('#415E78')).toEqual({ r: 65, g: 94, b: 120 })
  })

  it('uses dark text on neon green and white text on slate blue', () => {
    const green = parseHexColor('#00FF99')
    const slate = parseHexColor('#415E78')
    expect(green).not.toBeNull()
    expect(slate).not.toBeNull()
    expect(relativeLuminance(green!)).toBeGreaterThan(0.45)
    expect(relativeLuminance(slate!)).toBeLessThan(0.45)
    expect(onBrandColor(green!)).toBe('#0f172a')
    expect(onBrandColor(slate!)).toBe('#ffffff')
  })

  it('remaps legacy neon to the platform teal', () => {
    expect(resolveBrandSeed('#00FF99')).toBe('#0D9488')
    expect(resolveBrandSeed('')).toBe('#0D9488')
  })

  it('lifts dark slate brands so marks stay readable on dark chrome', () => {
    const slate = parseHexColor('#415E78')!
    const lifted = productAccent(slate, 'dark')
    expect(relativeLuminance(lifted)).toBeGreaterThan(relativeLuminance(slate))
    expect(markColor(slate, 'dark')).toMatch(/^rgb\(/)
  })
})
