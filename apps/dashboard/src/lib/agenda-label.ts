type AgendaAgent = { id: string; name: string; role_slug?: string | null; role_name?: string | null }
type AgendaTrigger = { id: string; agent_id: string | null; agent_role?: string }
type AgendaOccurrence = {
  agent_id: string | null
  agent_name: string | null
  trigger_id: string | null
  agent_role?: string
}

function roleMatches(role: string, agent: AgendaAgent): boolean {
  const slug = (agent.role_slug || agent.role_name || '').toLowerCase().replace(/[\s-]+/g, '_')
  const key = role.toLowerCase().replace(/[\s-]+/g, '_')
  if (!key) return false
  if (key === slug) return true
  if (['orchestrator', 'po', 'lead', 'manager'].includes(key)) {
    return ['orchestrator', 'po', 'lead', 'manager'].includes(slug)
  }
  if (['assistant', 'worker', 'agent'].includes(key)) {
    return ['assistant', 'worker', 'agent'].includes(slug)
  }
  return slug.includes(key)
}

/** True when a stored name is a role slug, not a display name. */
export function isAgendaRoleSlug(name: string | null | undefined): boolean {
  const raw = (name || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!raw) return false
  return ['orchestrator', 'po', 'lead', 'manager', 'assistant', 'worker', 'agent'].includes(raw)
}

/** Title-case a role slug for display when no agent name is known. */
export function humanizeAgendaActorName(name: string | null | undefined): string {
  const raw = (name || '').trim()
  if (!raw) return ''
  if (!isAgendaRoleSlug(raw) && !/^[a-z][a-z0-9_-]*$/.test(raw)) return raw
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

/** Resolve which agent a planned agenda card belongs to. */
export function resolveAgendaAgentId(
  item: { agent_id: string | null; trigger_id: string | null; agent_role?: string },
  triggers: AgendaTrigger[] = [],
  siblings: Array<{ trigger_id: string | null; agent_id: string | null }> = [],
  agents: AgendaAgent[] = [],
): string | null {
  if (item.agent_id) return item.agent_id
  const fromTrigger = item.trigger_id
    ? (triggers.find((trigger) => trigger.id === item.trigger_id)?.agent_id ?? null)
    : null
  if (fromTrigger) return fromTrigger
  if (item.trigger_id) {
    const sibling = siblings.find((row) => row.trigger_id === item.trigger_id && row.agent_id)
    if (sibling?.agent_id) return sibling.agent_id
  }
  const role = item.agent_role || triggers.find((trigger) => trigger.id === item.trigger_id)?.agent_role || ''
  return agents.find((agent) => roleMatches(role, agent))?.id ?? null
}

export function resolveAgendaAgentName(
  item: AgendaOccurrence,
  agents: AgendaAgent[],
  triggers: AgendaTrigger[] = [],
  siblings: Array<{ trigger_id: string | null; agent_id: string | null; agent_name: string | null }> = [],
): string {
  const explicit = item.agent_name?.trim() || ''
  if (explicit && !isAgendaRoleSlug(explicit)) return explicit
  if (item.trigger_id) {
    const siblingName = siblings.find((row) => row.trigger_id === item.trigger_id && row.agent_name?.trim())
      ?.agent_name
    if (siblingName?.trim() && !isAgendaRoleSlug(siblingName)) return siblingName.trim()
  }
  const agentId = resolveAgendaAgentId(item, triggers, siblings, agents)
  if (agentId) {
    const named = agents.find((agent) => agent.id === agentId)?.name
    if (named) return named
  }
  const roleHint =
    item.agent_role ||
    triggers.find((trigger) => trigger.id === item.trigger_id)?.agent_role ||
    (isAgendaRoleSlug(explicit) ? explicit : '') ||
    (isAgendaRoleSlug(item.agent_name) ? item.agent_name : '')
  if (roleHint) {
    const byRole = agents.find((agent) => roleMatches(roleHint, agent))?.name
    if (byRole) return byRole
    return humanizeAgendaActorName(roleHint)
  }
  return humanizeAgendaActorName(explicit)
}
