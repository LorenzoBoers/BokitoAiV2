import { describe, expect, it } from 'vitest'
import { findNavRowPath, navRowIndex, type NavRow } from './signals-api'
import { entityIcon, ENTITY_ICONS } from './entity-icons'
import { Layers } from 'lucide-react'

const TREE: NavRow[] = [
  {
    id: 'root',
    name: 'Clients',
    count: 3,
    children: [
      { id: 'acme', name: 'Acme', count: 2, parentId: 'root', children: [{ id: 'acme-q4', name: 'Q4', count: 1, parentId: 'acme' }] },
    ],
  },
  { id: 'ops', name: 'Operations', count: 0 },
]

describe('findNavRowPath', () => {
  it('finds nested folders with their ancestors first', () => {
    expect(findNavRowPath(TREE, 'acme-q4')?.map((row) => row.name)).toEqual(['Clients', 'Acme', 'Q4'])
    expect(findNavRowPath(TREE, 'ops')?.map((row) => row.name)).toEqual(['Operations'])
  })

  it('returns null for unknown ids', () => {
    expect(findNavRowPath(TREE, 'nope')).toBeNull()
  })
})

describe('navRowIndex', () => {
  it('indexes every folder with a readable path', () => {
    const index = navRowIndex(TREE)
    expect(index.get('acme-q4')).toEqual({ name: 'Q4', path: 'Clients / Acme / Q4' })
    expect(index.get('ops')).toEqual({ name: 'Operations', path: 'Operations' })
    expect(index.size).toBe(4)
  })
})

describe('entityIcon', () => {
  it('resolves Bin and audit aliases to the shared mark', () => {
    expect(entityIcon('playbook', Layers)).toBe(ENTITY_ICONS.flow)
    expect(entityIcon('signal', Layers)).toBe(ENTITY_ICONS.conversation)
    expect(entityIcon('workspace_doc', Layers)).toBe(ENTITY_ICONS.knowledge)
  })

  it('falls back for unknown kinds', () => {
    expect(entityIcon('mystery', Layers)).toBe(Layers)
    expect(entityIcon(null, Layers)).toBe(Layers)
  })
})
