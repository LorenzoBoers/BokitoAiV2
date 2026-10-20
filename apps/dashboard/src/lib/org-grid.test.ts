import { describe, expect, it } from 'vitest'
import { orgGridNodeId, orgGridPath } from './org-grid'

describe('org-grid', () => {
  it('builds kind:id node ids without double-prefixing', () => {
    expect(orgGridNodeId('agent', 'abc')).toBe('agent:abc')
    expect(orgGridNodeId('agent', 'agent:abc')).toBe('agent:abc')
    expect(orgGridNodeId('folder', 'proj-1')).toBe('folder:proj-1')
  })

  it('builds Grid paths with optional legend focus', () => {
    expect(orgGridPath()).toBe('/workforce/grid')
    expect(orgGridPath('agent:abc')).toBe('/workforce/grid?focus=agent%3Aabc')
    expect(orgGridPath({ kind: 'flow', id: 'ws-1' })).toBe('/workforce/grid?focus=flow%3Aws-1')
  })
})
