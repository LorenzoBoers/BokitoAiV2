import type { IntegrationKind } from './integration-kind'

export type IntegrationKindFilter = 'all' | IntegrationKind

const KIND_PARAMS = new Set(['all', 'inbox', 'repository', 'mcp'])

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
  const base = '/integrations/marketplace'
  const param = kindFilterToParam(kind)
  return param ? `${base}?kind=${param}` : base
}

export function connectedPathWithKind(kind: IntegrationKindFilter): string {
  const base = '/integrations/connected'
  const param = kindFilterToParam(kind)
  return param ? `${base}?kind=${param}` : base
}
