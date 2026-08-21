import { describe, expect, it } from 'vitest'
import { onBrandColor, parseHexColor, relativeLuminance } from '../../../chat-widget/src/brand'

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
})
