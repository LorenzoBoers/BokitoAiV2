import type { IntegrationKind } from './integration-kind'

/**
 * Category chips on the Connections page. `modules` are domain presets,
 * `ai_tools` are the AI and coding tools that connect over MCP / Workbench.
 * The filter lives in the URL only (`?kind=`), so deeplinks and the browser
 * back button always show what the link said.
 */
export type IntegrationKindFilter = 'all' | 'modules' | 'ai_tools' | IntegrationKind

export const KIND_FILTERS: IntegrationKindFilter[] = [
  'all',
  'inbox',
  'calendar',
  'app',
  'mcp',
  'repository',
  'modules',
  'ai_tools',
]

const KIND_PARAMS = new Set<string>(KIND_FILTERS)

export function parseKindFilter(value: string | null): IntegrationKindFilter {
  if (value && KIND_PARAMS.has(value)) {
    return value as IntegrationKindFilter
  }
  return 'all'
}

export function kindFilterToParam(kind: IntegrationKindFilter): string | null {
  return kind === 'all' ? null : kind
}

export function connectionsPathWithKind(kind: IntegrationKindFilter): string {
  const base = '/connections'
  const param = kindFilterToParam(kind)
  return param ? `${base}?kind=${param}` : base
}

/** Where a legacy `/modules*`, `/settings/modules*` or `/connections/marketplace` path lands.
 *
 * The hub used to live at `/modules` with `connected`, `tools` and
 * `marketplace` as separate leaves; all are folded into `/connections` now,
 * and a module slug keeps its own page. Returns a path without the query
 * string — callers append it. */
export function legacyModulesPath(pathname: string): string {
  if (
    pathname === '/connections/connected' ||
    pathname === '/connections/tools' ||
    pathname === '/connections/marketplace'
  ) {
    return '/connections'
  }
  const rest = pathname.replace(/^(\/settings)?\/modules/, '')
  if (rest === '/connected' || rest === '/tools' || rest === '/marketplace' || rest === '') {
    return '/connections'
  }
  return `/connections${rest}`
}
