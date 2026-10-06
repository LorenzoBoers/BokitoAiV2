import { describe, expect, it } from 'vitest'
import { parseHexColor, resolveBrandSeed, widgetBrandTokens } from '../../../chat-widget/src/brand'

describe('widget brand tokens', () => {
  it('parses 6-digit hex', () => {
    expect(parseHexColor('#415E78')).toEqual({ r: 65, g: 94, b: 120 })
  })

  it('uses white text on the platform mint and dark text on neon', () => {
    expect(widgetBrandTokens('#32BF8E', 'light')['--bk-on-primary']).toBe('rgb(255, 255, 255)')
    expect(widgetBrandTokens('#CCFF00', 'light')['--bk-on-primary']).toBe('rgb(17, 24, 39)')
  })

  it('remaps legacy neon and the old teal to the platform mint', () => {
    expect(resolveBrandSeed('#00FF99')).toBe('#32BF8E')
    expect(resolveBrandSeed('#0D9488')).toBe('#32BF8E')
    expect(resolveBrandSeed('')).toBe('#32BF8E')
  })

  it('gives white a neutral launcher instead of a tinted one', () => {
    const tokens = widgetBrandTokens('#FFFFFF', 'light')
    const [r, g, b] = tokens['--bk-primary'].match(/\d+/g)!.map(Number)
    expect(r).toBe(g)
    expect(g).toBe(b)
    expect(tokens['--bk-launcher-icon']).toBe('rgb(255, 255, 255)')
  })
})
