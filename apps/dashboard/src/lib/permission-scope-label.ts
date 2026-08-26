import type { TFunction } from 'i18next'
import { humanizeLabel } from './labels'

const SCOPE_KEYS: Record<string, string> = {
  'platform:read': 'workforce.scopes.platformRead',
  'platform:graph:edit': 'workforce.scopes.graphEdit',
  'platform:agent:create': 'workforce.scopes.agentCreate',
  'platform:agent:update': 'workforce.scopes.agentUpdate',
  'platform:workstream:create': 'workforce.scopes.workstreamCreate',
  'platform:workstream:update': 'workforce.scopes.workstreamUpdate',
  'platform:doc:write': 'workforce.scopes.docWrite',
  'platform:integration:propose': 'workforce.scopes.integrationPropose',
  'platform:integration:create': 'workforce.scopes.integrationCreate',
  'platform:mcp:register': 'workforce.scopes.mcpRegister',
  'platform:edge:connect': 'workforce.scopes.edgeConnect',
}

/** Turn API permission scopes into short labels first-time users can read. */
export function permissionScopeLabel(scope: string | null | undefined, t: TFunction): string {
  const raw = (scope ?? '').trim()
  if (!raw) return ''
  const key = SCOPE_KEYS[raw]
  if (key) {
    const translated = t(key, { ns: 'nav', defaultValue: '' })
    if (translated) return translated
  }
  return humanizeLabel(raw.replace(/^platform:/, '').replace(/:/g, ' '))
}

export function formatPermissionScopes(
  scopes: string[] | null | undefined,
  t: TFunction,
  emptyLabel: string,
): string {
  const labels = (scopes ?? []).map((scope) => permissionScopeLabel(scope, t)).filter(Boolean)
  return labels.length > 0 ? labels.join(', ') : emptyLabel
}
