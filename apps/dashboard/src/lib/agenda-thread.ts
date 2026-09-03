import { agentChatPath, agentRunsPath } from './messages-paths'
import { agentWorkforceRunUrl } from './workforce-run-urls'

/** EN/NL titles that should match the same Agent-runs conversation. */
const SUBJECT_ALIASES: Record<string, string> = {
  'reply to customer message': 'reply-customer',
  'antwoord op klantbericht': 'reply-customer',
  'daily platform scan': 'daily-scan',
  'dagelijkse platformscan': 'daily-scan',
  'po wake: review platform backlog': 'po-backlog',
  'lead: platformbacklog bekijken': 'po-backlog',
  'agent passport update': 'passport',
  'agenttoegang bijgewerkt': 'passport',
  'po heartbeat': 'heartbeat',
  'orchestrator heartbeat': 'heartbeat',
  'lead-hartslag': 'heartbeat',
  heartbeat: 'heartbeat',
  'check-in': 'heartbeat',
}

function subjectKey(value: string): string {
  return SUBJECT_ALIASES[value.trim().toLowerCase()] ?? value.trim().toLowerCase()
}

/** Prefer the Agent-runs conversation that matches an Agenda occurrence. */

export function startedAtIso(startedAt?: number | string | null): string | null {
  if (typeof startedAt === 'number') {
    return new Date(startedAt < 1e12 ? startedAt * 1000 : startedAt).toISOString()
  }
  return startedAt ?? null
}

export function pickClosestThreadBySubject<
  T extends { id: string | number; emailSubject?: string | null; lastMessageAt?: string | null },
>(threads: T[], subject: string, aroundIso?: string | null): T | null {
  const needle = subjectKey(subject)
  if (!needle || threads.length === 0) return null
  const matches = threads.filter((thread) => subjectKey(thread.emailSubject ?? '') === needle)
  if (matches.length === 0) return null
  const pool = matches
  const target = aroundIso ? new Date(aroundIso).getTime() : NaN
  if (!Number.isFinite(target)) return pool[0] ?? null
  return [...pool].sort((a, b) => {
    const aAt = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
    const bAt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
    return Math.abs(aAt - target) - Math.abs(bAt - target)
  })[0] ?? null
}

function occurrenceAtMs(at: string): number {
  return new Date(at.endsWith('Z') ? at : `${at}Z`).getTime()
}

/**
 * The thread a trigger posts into, straight from `signal_id` instead of a
 * subject guess. Check-ins land in the agent's own channel; other triggers
 * keep their internal run thread.
 */
export function triggerThreadPath(item: {
  kind?: string | null
  signal_id?: string | null
  agent_id?: string | null
  status?: string | null
}): string | null {
  if (!item.signal_id) return null
  if (item.kind === 'heartbeat' && item.agent_id) {
    return agentChatPath(item.agent_id, item.signal_id)
  }
  return agentRunsPath(item.status === 'completed' ? 'results' : 'all', item.signal_id)
}

/** Link a planned Agenda row: past/completed work opens Agent-runs; future wakes stay on Agenda. */
export function agendaOccurrenceHref(
  item: {
    name: string
    at: string
    kind?: string | null
    signal_id?: string | null
    status?: string | null
    run_id?: string | null
    agent_id?: string | null
    trigger_id?: string | null
  },
  threads: Array<{ id: string | number; emailSubject?: string | null; lastMessageAt?: string | null }>,
  fallbackAgentId: string,
  nowMs: number = Date.now(),
): string {
  const atMs = occurrenceAtMs(item.at)
  const isFuture = Number.isFinite(atMs) && atMs > nowMs
  if (!isFuture || item.run_id) {
    const direct = triggerThreadPath(item)
    if (direct) return direct
  }
  const match = !isFuture || item.run_id
    ? pickClosestThreadBySubject(threads, item.name, item.at)
    : null
  if (match) return agentRunsPath(item.run_id ? 'results' : 'all', String(match.id))
  if (item.run_id && item.agent_id) return agentWorkforceRunUrl(item.agent_id, item.run_id)
  if (item.trigger_id) return `/agenda?trigger=${item.trigger_id}`
  return `/agenda?agent=${fallbackAgentId}`
}

/** Open the matching Agent-runs conversation, or fall back to the raw work log. */
export function workLogRunsPath(
  run: { task_subject?: string | null; started_at?: number | string | null; status?: string },
  threads: Array<{ id: string | number; emailSubject?: string | null; lastMessageAt?: string | null }>,
  fallback: string,
): string {
  const thread = pickClosestThreadBySubject(threads, run.task_subject?.trim() ?? '', startedAtIso(run.started_at))
  if (!thread) return fallback
  return agentRunsPath(run.status === 'completed' ? 'results' : 'all', String(thread.id))
}
