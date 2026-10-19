import { TAB_PATHS } from './navigation'

/** Org-map node kinds that appear on Grid (see `apps/api/app/services/org_graph.py`). */
export type OrgGridKind =
  | 'organization'
  | 'department'
  | 'user'
  | 'agent'
  | 'channel'
  | 'flow'
  | 'label'
  | 'folder'
  | 'calendar'
  | 'connection'
  | 'module'
  | 'doc'
  | 'source'
  | 'webhook'

/** Canonical node id used by the org graph and Grid legend focus. */
export function orgGridNodeId(kind: OrgGridKind, id: string): string {
  const trimmed = id.trim()
  if (!trimmed) return kind
  if (trimmed.startsWith(`${kind}:`)) return trimmed
  return `${kind}:${trimmed}`
}

/**
 * Path to Grid. Pass a node id (or kind + id) to open with the same focus
 * as clicking that row in the legend.
 */
export function orgGridPath(focus?: string | { kind: OrgGridKind; id: string } | null): string {
  const base = TAB_PATHS.grid
  if (!focus) return base
  const nodeId = typeof focus === 'string' ? focus.trim() : orgGridNodeId(focus.kind, focus.id)
  if (!nodeId) return base
  return `${base}?focus=${encodeURIComponent(nodeId)}`
}
