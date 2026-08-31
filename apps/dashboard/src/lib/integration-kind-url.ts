import type { IntegrationKind } from './integration-kind'

export type IntegrationKindFilter = 'all' | IntegrationKind

const KIND_PARAMS = new Set(['all', 'inbox', 'repository', 'mcp', 'calendar'])

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
  const base = '/modules/marketplace'
  const param = kindFilterToParam(kind)
  return param ? `${base}?kind=${param}` : base
}

export function connectedPathWithKind(kind: IntegrationKindFilter): string {
  const base = '/modules/connected'
  const param = kindFilterToParam(kind)
  return param ? `${base}?kind=${param}` : base
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
