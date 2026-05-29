import type { RuntimeAgent } from './workforce-api'

/** Roles treated as platform agents (excluded from "Your agents" sidebar list). */
export const PLATFORM_ROLE_SLUGS = new Set(['po', 'assistant', 'communication', 'manager'])
const PO_ROLE_SLUGS = new Set(['po', 'manager', 'product-owner', 'product_owner'])

export function normalizeRoleSlug(agent: RuntimeAgent): string {
  return (agent.role_slug ?? '').toLowerCase()
}

export type AgentType = 'po' | 'worker'

export function isPoAgent(agent: RuntimeAgent): boolean {
  const slug = normalizeRoleSlug(agent)
  if (PO_ROLE_SLUGS.has(slug)) return true
  const roleName = (agent.role_name ?? '').toLowerCase()
  return roleName.includes('product owner') || roleName === 'po'
}

export function agentType(agent: RuntimeAgent): AgentType {
  return isPoAgent(agent) ? 'po' : 'worker'
}

export function isPlatformAgent(agent: RuntimeAgent): boolean {
  return PLATFORM_ROLE_SLUGS.has(normalizeRoleSlug(agent))
}

export function filterUserAgents(agents: RuntimeAgent[]): RuntimeAgent[] {
  return agents.filter((agent) => !isPlatformAgent(agent))
}

export function filterPoAgents(agents: RuntimeAgent[]): RuntimeAgent[] {
  return agents.filter(isPoAgent)
}

/** PO sidebar target: single agent detail, multi-agent list page, or null when none. */
export function resolvePoNavTarget(agents: RuntimeAgent[]): string | null {
  const poAgents = filterPoAgents(agents)
  if (poAgents.length === 1) return `/ai/agents/${poAgents[0].id}`
  if (poAgents.length > 1) return '/workforce/po'
  return null
}

export function sortAgentsByUpdated(agents: RuntimeAgent[]): RuntimeAgent[] {
  return [...agents].sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0))
}

export function isWorkforceRoute(pathname: string): boolean {
  return (
    pathname.startsWith('/workforce') ||
    pathname.startsWith('/ai/') ||
    pathname.startsWith('/admin/runs')
  )
}
