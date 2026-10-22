import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { darkColors, hexCss, lightColors } from './colors'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(packageRoot, '../..')
const generatedArtifacts = [
  'apps/dashboard/src/styles/tokens.generated.css',
  'packages/ui-tokens/tailwind-preset.generated.cjs',
  'packages/ui-tokens/src/theme.generated.ts',
]

describe('ui tokens', () => {
  it('pins the dashboard dark and light backgrounds', () => {
    expect(darkColors.bg).toEqual([18, 18, 19])
    expect(lightColors.bg).toEqual([244, 244, 243])
    expect(hexCss(darkColors.bg)).toBe('#121213')
    expect(darkColors.ai).toEqual([139, 92, 246])
    expect(lightColors.accent).toEqual([20, 166, 116])
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
