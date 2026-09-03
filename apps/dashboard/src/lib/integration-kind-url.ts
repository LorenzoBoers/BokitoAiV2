import type { IntegrationKind } from './integration-kind'

export type IntegrationKindFilter = 'all' | IntegrationKind

const KIND_PARAMS = new Set(['all', 'inbox', 'repository', 'mcp', 'calendar', 'app'])

export function parseKindFilter(value: string | null): IntegrationKindFilter {
  if (value && KIND_PARAMS.has(value)) {
    return value as IntegrationKindFilter
  }
  return 'all'
}

export function kindFilterToParam(kind: IntegrationKindFilter): string | null {
  return kind === 'all' ? null : kind
}

export function marketplacePathWithKind(kind: IntegrationKindFilter): string {
  const base = '/connections/marketplace'
  const param = kindFilterToParam(kind)
  return param ? `${base}?kind=${param}` : base
}

export function connectedPathWithKind(kind: IntegrationKindFilter): string {
  const base = '/connections'
  const param = kindFilterToParam(kind)
  return param ? `${base}?kind=${param}` : base
}

/** Where a legacy `/modules*` or `/settings/modules*` path lands on the hub.
 *
 * The hub used to live at `/modules` with `connected` and `tools` as separate
 * leaves; both are folded into `/connections` now, and a module slug keeps its
 * own page. Returns a path without the query string — callers append it. */
export function legacyModulesPath(pathname: string): string {
  const rest = pathname.replace(/^(\/settings)?\/modules/, '')
  if (rest === '/connected' || rest === '/tools' || rest === '') return '/connections'
  return `/connections${rest}`
}

export type MarketplaceStatusFilter = 'all' | 'connected' | 'available'

export function parseStatusFilter(value: string | null): MarketplaceStatusFilter {
  if (value === 'all' || value === 'connected') return value
  return 'available'
}

const LAST_KIND_KEY = 'bokito.lastIntegrationKind'

export function readLastIntegrationKind(): IntegrationKindFilter {
  try {
    return parseKindFilter(window.localStorage.getItem(LAST_KIND_KEY))
  } catch {
    return 'all'
  }
}

export function writeLastIntegrationKind(kind: IntegrationKindFilter): void {
  try {
    if (kind === 'all') window.localStorage.removeItem(LAST_KIND_KEY)
    else window.localStorage.setItem(LAST_KIND_KEY, kind)
  } catch {
    // Private mode or quota — URL still carries the filter.
  }
}
