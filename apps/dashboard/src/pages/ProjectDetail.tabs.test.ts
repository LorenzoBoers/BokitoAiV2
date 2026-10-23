import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { contentsCountLabel } from '../components/projects/FolderContents'

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ProjectDetail.tsx'), 'utf8')

describe('ProjectDetail container', () => {
  it('lists folder contents and keeps a canvas open from the query', () => {
    expect(src).toContain('<FolderContents')
    expect(src).toContain('searchParams.get(\'canvas\')')
    expect(src).toContain('<CanvasHost')
    expect(src).not.toContain('openInCommunication')
    expect(src).not.toContain('WorksInSection')
    expect(src).not.toContain('ProjectFlowBoards')
    expect(src).not.toContain('value="tickets"')
  })

  it('caps a tab count at 99+', () => {
    expect(contentsCountLabel(12)).toBe('12')
    expect(contentsCountLabel(99)).toBe('99')
    expect(contentsCountLabel(100)).toBe('99+')
  })
})
