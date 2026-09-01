import type { IntegrationKind } from './integration-kind'
import type { ResolvedIntegrationBrand } from './integration-brand'

export type ConnectionListSource = 'app' | 'mcp' | 'github' | 'calendar' | 'inbox'

export type ConnectionListItem = {
  id: string
  kind: IntegrationKind
  programKey: string
  programName: string
  title: string
  subtitle: string | null
  brand: ResolvedIntegrationBrand
  attachedModules: string[]
  eligibleModule: string | null
  source: ConnectionListSource
  connectionId: string
}

export type ConnectionProgramGroup = {
  programKey: string
  programName: string
  brand: ResolvedIntegrationBrand
  kind: IntegrationKind
  items: ConnectionListItem[]
}

export type ConnectionKindGroup = {
  kind: IntegrationKind
  programs: ConnectionProgramGroup[]
}

/** Daily ops first; code last so GitHub stays in the background. */
export const CONNECTION_KIND_ORDER: IntegrationKind[] = [
  'inbox',
  'calendar',
  'app',
  'mcp',
  'repository',
]

export function groupConnectionItems(items: ConnectionListItem[]): ConnectionKindGroup[] {
  const byKind = new Map<IntegrationKind, Map<string, ConnectionProgramGroup>>()

  for (const item of items) {
    let programs = byKind.get(item.kind)
    if (!programs) {
      programs = new Map()
      byKind.set(item.kind, programs)
    }
    let program = programs.get(item.programKey)
    if (!program) {
      program = {
        programKey: item.programKey,
        programName: item.programName,
        brand: item.brand,
        kind: item.kind,
        items: [],
      }
      programs.set(item.programKey, program)
    }
    program.items.push(item)
  }

  return CONNECTION_KIND_ORDER.flatMap((kind) => {
    const programs = byKind.get(kind)
    if (!programs || programs.size === 0) return []
    return [
      {
        kind,
        programs: [...programs.values()].sort((a, b) =>
          a.programName.localeCompare(b.programName, undefined, { sensitivity: 'base' }),
        ),
      },
    ]
  })
}

export function filterConnectionItems(
  items: ConnectionListItem[],
  needle: string,
): ConnectionListItem[] {
  const q = needle.trim().toLowerCase()
  if (!q) return items
  return items.filter((item) =>
    `${item.programName} ${item.title} ${item.subtitle ?? ''} ${item.kind}`
      .toLowerCase()
      .includes(q),
  )
}
