import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ProjectDetail.tsx'), 'utf8')

describe('ProjectDetail tabs', () => {
  it('keeps the active tab in the URL and maps legacy queue to Home', () => {
    expect(src).toContain('value={tab}')
    expect(src).toContain("if (raw === 'queue') return 'home'")
    expect(src).toContain('value="canvas"')
    expect(src).toContain('value="docs"')
    expect(src).toContain('value="settings"')
    expect(src).not.toContain('value="queue"')
    expect(src).not.toContain('tabQueue')
  })
})
