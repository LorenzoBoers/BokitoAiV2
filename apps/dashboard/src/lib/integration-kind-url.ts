import type { IntegrationKind } from './integration-kind'

/**
 * Category chips on the Connections page. `modules` are domain presets,
 * `ai_tools` are the AI and coding tools that connect over MCP / Workbench.
 * The filter lives in the URL only (`?kind=`), so deeplinks and the browser
 * back button always show what the link said.
 */
export type IntegrationKindFilter = 'all' | 'modules' | 'ai_tools' | IntegrationKind

/** Hub leaf: Discover (catalog) vs Installed (every registration). */
export type ConnectionsHubTab = 'discover' | 'installed'

export const CONNECTIONS_DISCOVER_PATH = '/connections'
export const CONNECTIONS_INSTALLED_PATH = '/connections/installed'

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
  const base = CONNECTIONS_DISCOVER_PATH
  const param = kindFilterToParam(kind)
  return param ? `${base}?kind=${param}` : base
}

export function connectionsInstalledPath(opts?: {
  kind?: IntegrationKindFilter
  q?: string
  view?: 'cards' | 'list'
}): string {
  const params = new URLSearchParams()
  if (opts?.kind && opts.kind !== 'all') params.set('kind', opts.kind)
  if (opts?.q?.trim()) params.set('q', opts.q.trim())
  if (opts?.view === 'list') params.set('view', 'list')
  const qs = params.toString()
  return qs ? `${CONNECTIONS_INSTALLED_PATH}?${qs}` : CONNECTIONS_INSTALLED_PATH
}

export function parseConnectionsView(value: string | null): 'cards' | 'list' {
  return value === 'list' ? 'list' : 'cards'
}

/** Where a legacy `/modules*`, `/settings/modules*` or `/connections/marketplace` path lands.
 *
 * The hub used to live at `/modules` with `connected`, `tools` and
 * `marketplace` as separate leaves; Discover is `/connections`, Installed is
 * `/connections/installed`, and a module slug keeps its own page. Returns a
 * path without the query string — callers append it. */
export function legacyModulesPath(pathname: string): string {
  if (pathname === '/connections/connected' || pathname === '/modules/connected') {
    return CONNECTIONS_INSTALLED_PATH
  }
  if (pathname === '/connections/tools' || pathname === '/connections/marketplace') {
    return CONNECTIONS_DISCOVER_PATH
  }
  const rest = pathname.replace(/^(\/settings)?\/modules/, '')
  if (rest === '/connected') return CONNECTIONS_INSTALLED_PATH
  if (rest === '/tools' || rest === '/marketplace' || rest === '') {
    return CONNECTIONS_DISCOVER_PATH
  }
  return `/connections${rest}`
}
