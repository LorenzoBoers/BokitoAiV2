import { describe, expect, it } from 'vitest'
import { formatPermissionScopes, permissionScopeLabel } from './permission-scope-label'

const t = (key: string) => {
  const map: Record<string, string> = {
    'workforce.scopes.platformRead': 'Platform bekijken',
    'workforce.scopes.graphEdit': 'AI OS-canvas bewerken',
    'workforce.scopes.docWrite': 'Kennisdocumenten schrijven',
  }
  return map[key] ?? ''
}

describe('permissionScopeLabel', () => {
  it('maps known platform scopes to human copy', () => {
    expect(permissionScopeLabel('platform:read', t as never)).toBe('Platform bekijken')
    expect(permissionScopeLabel('platform:graph:edit', t as never)).toBe('AI OS-canvas bewerken')
  })

  it('falls back to a readable sentence for unknown scopes', () => {
    expect(permissionScopeLabel('platform:custom:thing', t as never)).toBe('Custom thing')
  })
})

describe('formatPermissionScopes', () => {
  it('joins known scopes and uses the empty label when none exist', () => {
    expect(formatPermissionScopes(['platform:read', 'platform:doc:write'], t as never, 'rolstandaard')).toBe(
      'Platform bekijken, Kennisdocumenten schrijven',
    )
    expect(formatPermissionScopes([], t as never, 'rolstandaard')).toBe('rolstandaard')
  })
})
