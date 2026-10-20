import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { TAB_PATHS } from './navigation'
import { LEGACY_REDIRECTS, redirectPathname } from './legacy-redirects'

const appSource = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../App.tsx'),
  'utf8',
)

function declaredPaths(): string[] {
  return [...appSource.matchAll(/path="([^"]+)"/g)].map((match) => match[1])
}

function patternMatches(pattern: string, pathname: string): boolean {
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2)
    return pathname === prefix || pathname.startsWith(`${prefix}/`)
  }
  const parts = pattern.split('/').filter(Boolean)
  const actual = pathname.split('/').filter(Boolean)
  if (parts.length !== actual.length) return false
  return parts.every((part, index) => part.startsWith(':') || part === actual[index])
}

describe('legacy redirects', () => {
  it('has one row per path and does not chain', () => {
    const froms = LEGACY_REDIRECTS.map((row) => row.from)
    expect(new Set(froms).size).toBe(froms.length)
    const fromSet = new Set(froms)
    for (const row of LEGACY_REDIRECTS) {
      expect(fromSet.has(redirectPathname(row.to))).toBe(false)
    }
  })

  it('sends every static path to a live route', () => {
    const live = declaredPaths().filter(
      (pattern) => !LEGACY_REDIRECTS.some((row) => row.from === pattern),
    )
    for (const row of LEGACY_REDIRECTS) {
      const target = redirectPathname(row.to)
      const hit = live.some((pattern) => patternMatches(pattern, target))
      expect(hit, `${row.from} -> ${target}`).toBe(true)
    }
  })

  it('keeps every rail path on a live route', () => {
    const live = declaredPaths()
    for (const pathname of Object.values(TAB_PATHS)) {
      const hit = live.some((pattern) => patternMatches(pattern, pathname))
      expect(hit, pathname).toBe(true)
    }
  })
})
