/**
 * One place that knows where each object opens. Feeds, badges, notifications,
 * decision cards and the command palette all link through `openEntityPath`.
 */
import { activityTerminalPath, forYouPath, inboxPath, type InboxQueue } from './messages-paths'

type ThreadLike = { id: string | number; emailSubject?: string | null; lastMessageAt?: string | null }

export type EntityRef =
  | { type: 'signal'; id: string | number; queue?: InboxQueue; messageId?: string | null }
  | { type: 'decision'; signalId?: string | null; messageId?: string | null }
  | { type: 'run'; id?: string | null; agentId?: string | null }
  | {
      type: 'agent'
      id: string
      live?: { threadId?: string | null; activityId?: string | null } | null
    }
  | { type: 'trigger'; id?: string | null; agentId?: string | null }
  | { type: 'calendar' }
  | { type: 'project'; id: string }
  | { type: 'work_item'; id?: string | null; projectId?: string | null }
  | { type: 'contact'; id: string }
  | { type: 'platform_change'; id?: string | null }
  | { type: 'notification'; kind: string; payload: Record<string, unknown> }

const enc = encodeURIComponent

type NotificationRef = Extract<EntityRef, { type: 'notification' }>

export function openEntityPath(ref: NotificationRef): string | null
export function openEntityPath(ref: Exclude<EntityRef, NotificationRef>): string
export function openEntityPath(ref: EntityRef): string | null
export function openEntityPath(ref: EntityRef): string | null {
  switch (ref.type) {
    case 'signal': {
      const base = inboxPath(ref.queue ?? 'all', String(ref.id))
      return ref.messageId ? `${base}?message=${enc(ref.messageId)}` : base
    }
    case 'decision':
      if (!ref.signalId) return forYouPath()
      // `?message=` scrolls straight to the card instead of the thread top.
      return forYouPath(ref.signalId, ref.messageId ? { message: ref.messageId } : undefined)
    case 'run':
      if (ref.id && ref.agentId) return `/agents/${enc(ref.agentId)}/runs/${enc(ref.id)}`
      return activityTerminalPath(ref.agentId)
    case 'agent':
      if (ref.live?.threadId) return inboxPath('open', ref.live.threadId)
      if (ref.live?.activityId) return openEntityPath({ type: 'run', id: ref.live.activityId, agentId: ref.id })
      return `/agents/${enc(ref.id)}`
    case 'trigger':
      if (ref.id) return `/agenda?trigger=${enc(ref.id)}`
      return ref.agentId ? `/agenda?agent=${enc(ref.agentId)}` : '/agenda'
    case 'calendar':
      return '/agenda'
    case 'project':
      return `/projects/${enc(ref.id)}`
    case 'work_item':
      return ref.projectId ? `/projects/${enc(ref.projectId)}` : '/agenda'
    case 'contact':
      return `/contacts/${enc(ref.id)}`
    case 'platform_change':
      return '/settings/govern?tab=drafts'
    case 'notification':
      return notificationPath(ref.kind, ref.payload)
  }
}

function stringField(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

/** The thread id on a notification payload (`thread_id` on older rows). */
export function notificationSignalId(payload: Record<string, unknown>): string | null {
  return stringField(payload, 'signal_id') ?? stringField(payload, 'thread_id')
}

function notificationPath(kind: string, payload: Record<string, unknown>): string | null {
  const signalId = notificationSignalId(payload)
  if (kind === 'decision_request') {
    return openEntityPath({ type: 'decision', signalId, messageId: stringField(payload, 'message_id') })
  }
  // All keeps pending, unassigned and closed deep links on the intended thread.
  if (signalId) return openEntityPath({ type: 'signal', id: signalId })

  const changeId = stringField(payload, 'platform_change_id')
  if (changeId) return openEntityPath({ type: 'platform_change', id: changeId })
  const agentId = stringField(payload, 'agent_id')
  if (agentId) return openEntityPath({ type: 'agent', id: agentId })
  const contactId = stringField(payload, 'contact_id')
  if (contactId) return openEntityPath({ type: 'contact', id: contactId })
  if (stringField(payload, 'trigger_id')) return openEntityPath({ type: 'trigger' })

  const channel = (stringField(payload, 'channel') ?? '').toLowerCase()
  const internal =
    stringField(payload, 'folder') === 'internal' || channel === 'internal' || channel === 'assistant'
  if (kind === 'ops_alert') {
    return stringField(payload, 'account_id') ? '/settings/channels' : activityTerminalPath()
  }
  if (kind === 'status_update') return internal ? activityTerminalPath() : inboxPath('all')
  return null
}

/** An activity or audit row: its conversation, run, or audited resource. */
export function activityEntryPath(entry: {
  signalId?: string | null
  runId?: string | null
  agentId?: string | null
  resourceType?: string | null
  resourceId?: string | null
}): string | null {
  const resourceId = entry.resourceId ?? null
  const signalId = entry.signalId ?? (entry.resourceType === 'signal' ? resourceId : null)
  if (signalId) return openEntityPath({ type: 'signal', id: signalId })
  if (entry.runId && entry.agentId) return openEntityPath({ type: 'run', id: entry.runId, agentId: entry.agentId })
  if (resourceId) {
    switch (entry.resourceType) {
      case 'agent':
        return openEntityPath({ type: 'agent', id: resourceId })
      case 'project':
        return openEntityPath({ type: 'project', id: resourceId })
      case 'contact':
        return openEntityPath({ type: 'contact', id: resourceId })
      case 'trigger':
        return openEntityPath({ type: 'trigger', id: resourceId })
      case 'platform_change':
        return openEntityPath({ type: 'platform_change', id: resourceId })
    }
  }
  return entry.agentId ? openEntityPath({ type: 'agent', id: entry.agentId }) : null
}

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

function startedAtIso(startedAt?: number | string | null): string | null {
  if (typeof startedAt === 'number') {
    return new Date(startedAt < 1e12 ? startedAt * 1000 : startedAt).toISOString()
  }
  return startedAt ?? null
}

/**
 * Older runs carry no thread id: pick the Agent-runs conversation with the same
 * subject, nearest in time.
 */
export function pickClosestThreadBySubject<T extends ThreadLike>(
  threads: T[],
  subject: string,
  aroundIso?: string | null,
): T | null {
  const needle = subjectKey(subject)
  if (!needle || threads.length === 0) return null
  const matches = threads.filter((thread) => subjectKey(thread.emailSubject ?? '') === needle)
  if (matches.length === 0) return null
  const target = aroundIso ? new Date(aroundIso).getTime() : NaN
  if (!Number.isFinite(target)) return matches[0] ?? null
  return (
    [...matches].sort((a, b) => {
      const aAt = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
      const bAt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
      return Math.abs(aAt - target) - Math.abs(bAt - target)
    })[0] ?? null
  )
}

/** A work log opens its conversation when one matches, else the run page. */
export function runThreadPath(
  run: { id: string; agent_id?: string | null; task_subject?: string | null; started_at?: number | string | null },
  threads: ThreadLike[],
): string {
  const thread = pickClosestThreadBySubject(threads, run.task_subject?.trim() ?? '', startedAtIso(run.started_at))
  if (thread) return inboxPath('all', String(thread.id))
  return openEntityPath({ type: 'run', id: run.id, agentId: run.agent_id }) ?? activityTerminalPath()
}
