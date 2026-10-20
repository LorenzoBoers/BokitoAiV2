import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { darkColors, hexCss, lightColors } from './colors'

describe('ui tokens', () => {
  it('pins the dashboard dark and light backgrounds', () => {
    expect(darkColors.bg).toEqual([18, 18, 19])
    expect(lightColors.bg).toEqual([244, 244, 243])
    expect(hexCss(darkColors.bg)).toBe('#121213')
    expect(darkColors.ai).toEqual([139, 92, 246])
    expect(lightColors.accent).toEqual([20, 166, 116])
  })

  it('matches the generated dashboard stylesheet', () => {
    const file = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../apps/dashboard/src/styles/tokens.generated.css',
    )
    const css = readFileSync(file, 'utf8')
    expect(css).toContain('--color-bg: 18 18 19;')
    expect(css).toContain('--color-bg: 244 244 243;')
    expect(css).toContain('--color-ai: 139 92 246;')
    expect(css).toContain('--body-bg: #121213;')
    expect(css).toContain('--body-bg: #f4f4f3;')
  })
})
