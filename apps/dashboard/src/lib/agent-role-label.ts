import type { TFunction } from 'i18next'
import { humanizeLabel } from './labels'

const ROLE_KEYS: Record<string, string> = {
  orchestrator: 'workforce.agents.types.orchestrator',
  orchestra: 'workforce.agents.types.orchestrator',
  po: 'workforce.agents.types.po',
  lead: 'workforce.agents.types.orchestrator',
  worker: 'workforce.agents.types.worker',
  agent: 'workforce.agents.types.worker',
}

/** Map API role slugs and leftover "Orchestrator" labels to Lead / Agent. */
export function agentRoleLabel(role: string | null | undefined, t: TFunction): string {
  const raw = (role ?? '').trim()
  if (!raw) return t('workforce.agents.types.worker', { ns: 'nav' })
  const key = raw.toLowerCase().replace(/[\s-]+/g, '_')
  const mapped = ROLE_KEYS[key]
  if (mapped) return t(mapped, { ns: 'nav' })
  return humanizeLabel(raw)
}
