import { describe, expect, it } from 'vitest'
import { normalizeWorkspaceSubdomain, validateWorkspaceSubdomain } from './workspace-subdomain'

describe('workspace subdomain', () => {
  it('normalizes to lowercase kebab', () => {
    expect(normalizeWorkspaceSubdomain('Acme Corp!')).toBe('acme-corp')
  })

  it('rejects empty and short or invalid values', () => {
    expect(validateWorkspaceSubdomain('')).toBe('required')
    expect(validateWorkspaceSubdomain('ab')).toBe('format')
    expect(validateWorkspaceSubdomain('-acme')).toBe('format')
    expect(validateWorkspaceSubdomain('acme')).toBeNull()
  })
})
