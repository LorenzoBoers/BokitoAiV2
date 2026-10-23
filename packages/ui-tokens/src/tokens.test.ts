import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { darkColors, hexCss, lightColors, type ColorName, type ColorScheme, type Rgb } from './colors'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(packageRoot, '../..')
const generatedArtifacts = [
  'apps/dashboard/src/styles/tokens.generated.css',
  'packages/ui-tokens/tailwind-preset.generated.cjs',
  'packages/ui-tokens/src/theme.generated.ts',
]

describe('ui tokens', () => {
  it('pins the dashboard dark and light backgrounds', () => {
    expect(darkColors.bg).toEqual([36, 36, 35])
    expect(lightColors.bg).toEqual([250, 250, 248])
    expect(hexCss(darkColors.bg)).toBe('#242423')
    expect(darkColors.ai).toEqual([169, 139, 255])
    expect(lightColors.accent).toEqual([12, 125, 86])
  })

  it('matches a fresh emit of the three artifacts', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'bokito-tokens-'))
    try {
      const result = spawnSync(
        process.execPath,
        ['--experimental-strip-types', path.join(packageRoot, 'scripts/emit.mjs'), '--out', out],
        { encoding: 'utf8' },
      )
      expect(result.status, result.stderr).toBe(0)
      for (const rel of generatedArtifacts) {
        const committed = readFileSync(path.join(repoRoot, rel))
        const fresh = readFileSync(path.join(out, rel))
        expect(committed.equals(fresh), 'draai `npm run emit -w @bokito/ui-tokens`').toBe(true)
      }
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
})

const MIN_TEXT_CONTRAST = 4.5

const linear = (c: number) => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const luminance = ([r, g, b]: Rgb) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const TEXT_ON: [ColorName, ColorName[]][] = [
  ['textMuted', ['bg', 'bgSurface', 'bgElevated', 'bgHover']],
  ['accentFg', ['accent']],
  ['aiFg', ['ai']],
  ...(['accentInk', 'aiInk', 'statusSuccess', 'statusWarning', 'statusError', 'statusInfo'] as ColorName[]).map(
    (fg): [ColorName, ColorName[]] => [fg, ['bg', 'bgSurface']],
  ),
]

describe.each<[string, ColorScheme]>([
  ['dark', darkColors],
  ['light', lightColors],
])('text contrast (%s)', (_theme, scheme) => {
  for (const [fg, surfaces] of TEXT_ON) {
    for (const surface of surfaces) {
      it(`${fg} on ${surface} reaches ${MIN_TEXT_CONTRAST}:1`, () => {
        expect(contrast(scheme[fg], scheme[surface])).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
      })
    }
  }
})
