import type { RuntimeAgent } from './workforce-api'

/** Roles treated as platform agents (excluded from "Your agents" sidebar list). */
export const PLATFORM_ROLE_SLUGS = new Set([
  'orchestrator',
  'po',
  'manager',
  'assistant',
  'communication',
])
/** Slugs that identify an orchestrator (canonical + legacy po/manager). */
const ORCHESTRATOR_ROLE_SLUGS = new Set(['orchestrator', 'po', 'manager'])

export function normalizeRoleSlug(agent: RuntimeAgent): string {
  return (agent.role_slug ?? '').toLowerCase()
}

export type AgentType = 'orchestrator' | 'worker'

export function isOrchestratorAgent(agent: RuntimeAgent): boolean {
  const slug = normalizeRoleSlug(agent)
  if (ORCHESTRATOR_ROLE_SLUGS.has(slug)) return true
  const roleName = (agent.role_name ?? '').toLowerCase()
  return roleName === 'orchestrator' || roleName.includes('product owner')
}

export function agentType(agent: RuntimeAgent): AgentType {
  return isOrchestratorAgent(agent) ? 'orchestrator' : 'worker'
}

export function isPlatformAgent(agent: RuntimeAgent): boolean {
  return PLATFORM_ROLE_SLUGS.has(normalizeRoleSlug(agent))
}

export function filterUserAgents(agents: RuntimeAgent[]): RuntimeAgent[] {
  return agents.filter((agent) => !isPlatformAgent(agent))
}

export function filterOrchestratorAgents(agents: RuntimeAgent[]): RuntimeAgent[] {
  return agents.filter(isOrchestratorAgent)
}

/** Orchestrator sidebar target: single agent detail, multi-agent list page, or null when none. */
export function resolveOrchestratorNavTarget(agents: RuntimeAgent[]): string | null {
  const orchestrators = filterOrchestratorAgents(agents)
  if (orchestrators.length === 1) return `/agents/${orchestrators[0].id}`
  if (orchestrators.length > 1) return '/agents'
  return null
}

export function sortAgentsByUpdated(agents: RuntimeAgent[]): RuntimeAgent[] {
  return [...agents].sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0))
}

export function isAiOsRoute(pathname: string): boolean {
  if (pathname === '/projects/new' || pathname.startsWith('/projects/new/')) return false
  return (
    pathname.startsWith('/os') ||
    pathname === '/orchestra' ||
    pathname.startsWith('/orchestra/') ||
    pathname.startsWith('/projects') ||
    pathname.startsWith('/project/') ||
    pathname.startsWith('/workforce') ||
    pathname.startsWith('/ai/agents') ||
    pathname.startsWith('/admin/runs')
  )
}

export function isWorkforceRoute(pathname: string): boolean {
  return (
    pathname.startsWith('/workforce') ||
    pathname.startsWith('/ai/') ||
    pathname.startsWith('/admin/runs') ||
    pathname.startsWith('/os')
  )
}
