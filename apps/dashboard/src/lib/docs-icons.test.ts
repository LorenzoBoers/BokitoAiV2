import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { docsIcon } from './docs-icons'

const docsRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/product-help',
)

function markdownFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return markdownFiles(full)
    return entry.name.endsWith('.md') ? [full] : []
  })
}

describe('docs icon tokens', () => {
  it('every {icon:...} token in product help maps to an icon', () => {
    const broken: string[] = []
    for (const file of markdownFiles(docsRoot)) {
      const text = fs.readFileSync(file, 'utf8')
      for (const match of text.matchAll(/\{icon:([^}]*)\}/g)) {
        if (!/^[a-z0-9-]+$/.test(match[1]) || !docsIcon(match[1])) {
          broken.push(`${path.relative(docsRoot, file)}: ${match[0]}`)
        }
      }
    }
    expect(broken).toEqual([])
  })
})
