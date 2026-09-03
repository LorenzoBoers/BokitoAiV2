import { activityTerminalPath } from './messages-paths'

/** Provenance shape the API puts on `payload.decision.source`. */
export type DecisionSource = {
  type: 'agent_task' | 'project' | 'agent_run' | 'platform_change'
  id: string
  projectId: string | null
}

const TYPES = new Set(['agent_task', 'project', 'agent_run', 'platform_change'])

/** Read the provenance block off a decision payload, ignoring junk. */
export function parseDecisionSource(raw: unknown): DecisionSource | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const type = typeof row.type === 'string' ? row.type : ''
  const id = typeof row.id === 'string' ? row.id : ''
  if (!TYPES.has(type) || !id) return null
  return {
    type: type as DecisionSource['type'],
    id,
    projectId: typeof row.project_id === 'string' ? row.project_id : null,
  }
}

/** Where to look at the thing that raised this decision. */
export function decisionSourcePath(source: DecisionSource): string {
  switch (source.type) {
    case 'agent_task':
      return source.projectId ? `/projects/${source.projectId}` : '/agenda'
    case 'project':
      return `/projects/${source.id}`
    case 'agent_run':
      return activityTerminalPath()
    case 'platform_change':
      return '/settings/govern?tab=drafts'
  }
}

/** i18n key for the source label, under `decisionCard.source.*`. */
export function decisionSourceLabelKey(source: DecisionSource): string {
  return `decisionCard.source.${source.type}`
}
