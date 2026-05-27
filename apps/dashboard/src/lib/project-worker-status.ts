import type { TFunction } from 'i18next'
import type { ProjectRow } from './projects-api'
import type { ProjectOrchestrationConfig } from './project-orchestration-api'

export type WorkerSetupState =
  | 'not_connected'
  | 'index_pending'
  | 'indexing'
  | 'index_error'
  | 'ready'

export type WorkerOperationalState =
  | 'blocked'
  | 'attention'
  | 'running'
  | 'error'
  | 'paused'
  | 'scheduled'
  | 'idle'

export type WorkerStatusSnapshot = {
  setup: WorkerSetupState
  primary: WorkerOperationalState
  blockingCount: number
  attentionCount: number
  /** Single badge number: blocking wins over attention. */
  badgeCount: number
  primaryKey: string
  setupKey?: string
  hints: {
    nextWakeAt?: string | null
    lastRunFailed?: boolean
    budgetBlocked?: boolean
    lastActiveAt?: string | null
  }
}

export type WorkerStatusInputs = {
  project: Pick<ProjectRow, 'github_repo_full_name' | 'repo_index_status'>
  blockingCount: number
  attentionCount: number
  budgetBlocked: boolean
  hasRunningWorkLog: boolean
  runAwaitingHuman: boolean
  lastRunFailed: boolean
  lastActiveAt?: string | null
  orchestration: Pick<
    ProjectOrchestrationConfig,
    'continuous_enabled' | 'wake_cadence' | 'next_po_wake_at' | 'last_po_wake_at'
  > | null
}

const SETUP_KEYS: Record<WorkerSetupState, string> = {
  not_connected: 'backgroundWorkers.setup.notConnected',
  index_pending: 'backgroundWorkers.setup.indexPending',
  indexing: 'backgroundWorkers.setup.indexing',
  index_error: 'backgroundWorkers.setup.indexError',
  ready: 'backgroundWorkers.setup.ready',
}

const PRIMARY_KEYS: Record<WorkerOperationalState, string> = {
  blocked: 'backgroundWorkers.status.blocked',
  attention: 'backgroundWorkers.status.attention',
  running: 'backgroundWorkers.status.running',
  error: 'backgroundWorkers.status.error',
  paused: 'backgroundWorkers.status.paused',
  scheduled: 'backgroundWorkers.status.scheduled',
  idle: 'backgroundWorkers.status.idle',
}

export function deriveWorkerSetup(
  project: Pick<ProjectRow, 'github_repo_full_name' | 'repo_index_status'>,
): WorkerSetupState {
  if (!project.github_repo_full_name) return 'not_connected'
  switch (project.repo_index_status) {
    case 'pending':
      return 'index_pending'
    case 'indexing':
      return 'indexing'
    case 'error':
      return 'index_error'
    case 'ready':
      return 'ready'
    default:
      return 'ready'
  }
}

function isWakeScheduled(nextPoWakeAt: string | null | undefined): boolean {
  if (!nextPoWakeAt) return false
  const t = new Date(nextPoWakeAt).getTime()
  return Number.isFinite(t) && t > Date.now()
}

function isPausedOrchestration(
  orchestration: WorkerStatusInputs['orchestration'],
): boolean {
  if (!orchestration) return false
  if (!orchestration.continuous_enabled) return true
  if (orchestration.wake_cadence === 'manual' && !orchestration.next_po_wake_at) return true
  return false
}

export function deriveWorkerStatus(inputs: WorkerStatusInputs): WorkerStatusSnapshot {
  const setup = deriveWorkerSetup(inputs.project)
  const setupKey = SETUP_KEYS[setup]

  const blockingCount = inputs.blockingCount
  const attentionCount = inputs.attentionCount
  const badgeCount = blockingCount > 0 ? blockingCount : attentionCount

  let primary: WorkerOperationalState = 'idle'

  if (
    blockingCount > 0 ||
    inputs.budgetBlocked ||
    inputs.runAwaitingHuman
  ) {
    primary = 'blocked'
  } else if (attentionCount > 0) {
    primary = 'attention'
  } else if (inputs.hasRunningWorkLog) {
    primary = 'running'
  } else if (
    inputs.lastRunFailed ||
    (setup === 'index_error' && inputs.orchestration?.continuous_enabled === true)
  ) {
    primary = 'error'
  } else if (isPausedOrchestration(inputs.orchestration)) {
    primary = 'paused'
  } else if (
    inputs.orchestration?.continuous_enabled &&
    isWakeScheduled(inputs.orchestration.next_po_wake_at)
  ) {
    primary = 'scheduled'
  } else {
    primary = 'idle'
  }

  return {
    setup,
    primary,
    blockingCount,
    attentionCount,
    badgeCount,
    primaryKey: PRIMARY_KEYS[primary],
    setupKey: setup !== 'ready' ? setupKey : undefined,
    hints: {
      nextWakeAt: inputs.orchestration?.next_po_wake_at ?? null,
      lastRunFailed: inputs.lastRunFailed,
      budgetBlocked: inputs.budgetBlocked,
      lastActiveAt: inputs.lastActiveAt ?? null,
    },
  }
}

/** Dot color for operational primary state (setup shown as secondary text when not idle). */
export function workerStatusDotClass(primary: WorkerOperationalState): string {
  switch (primary) {
    case 'blocked':
      return 'bg-status-error'
    case 'attention':
      return 'bg-status-warning'
    case 'running':
      return 'bg-status-success animate-pulse'
    case 'error':
      return 'bg-status-error'
    case 'paused':
    case 'scheduled':
      return 'bg-text-muted'
    case 'idle':
    default:
      return 'bg-text-muted/60'
  }
}

export function workerStatusTextClass(primary: WorkerOperationalState): string {
  switch (primary) {
    case 'blocked':
    case 'error':
      return 'text-status-error'
    case 'attention':
      return 'text-status-warning'
    case 'running':
      return 'text-status-success'
    case 'paused':
    case 'scheduled':
    case 'idle':
    default:
      return 'text-text-muted'
  }
}

const BLOCKING_MESSAGE_TYPES = new Set([
  'decision_request',
  'token_limit_reached',
])

const ATTENTION_MESSAGE_TYPES = new Set([
  'status_update',
  'token_warning',
  'integration_required',
])

export function countMessagesForProject(
  messages: { project_id?: string | null; message_type: string; status: string }[],
  projectId: string,
): { blockingCount: number; attentionCount: number } {
  let blockingCount = 0
  let attentionCount = 0
  for (const msg of messages) {
    if (msg.status !== 'awaiting_human') continue
    if (msg.project_id !== projectId) continue
    if (BLOCKING_MESSAGE_TYPES.has(msg.message_type)) {
      blockingCount += 1
    } else if (ATTENTION_MESSAGE_TYPES.has(msg.message_type)) {
      attentionCount += 1
    } else {
      attentionCount += 1
    }
  }
  return { blockingCount, attentionCount }
}

export function latestRunFailedByProject(
  workLogs: { project_id: string; status: string; started_at?: string | number | null }[],
): Map<string, boolean> {
  const latest = new Map<string, { status: string; at: number }>()
  for (const log of workLogs) {
    const at = log.started_at != null ? new Date(log.started_at).getTime() : 0
    const prev = latest.get(log.project_id)
    if (!prev || at >= prev.at) {
      latest.set(log.project_id, { status: log.status, at })
    }
  }
  const out = new Map<string, boolean>()
  for (const [projectId, { status }] of latest) {
    out.set(projectId, status === 'failed')
  }
  return out
}

function parseTimestamp(value: string | number | null | undefined): number | null {
  if (value == null) return null
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? t : null
}

function pickLatestIso(...candidates: (string | null | undefined)[]): string | null {
  let bestIso: string | null = null
  let bestAt = -1
  for (const iso of candidates) {
    if (!iso) continue
    const at = parseTimestamp(iso)
    if (at == null || at <= bestAt) continue
    bestAt = at
    bestIso = iso
  }
  return bestIso
}

/** Most recent agent run activity per project (finished_at, else started_at). */
export function latestActivityAtByProject(
  workLogs: {
    project_id: string
    started_at?: string | number | null
    finished_at?: string | number | null
  }[],
): Map<string, string> {
  const out = new Map<string, string>()
  for (const log of workLogs) {
    const at = parseTimestamp(log.finished_at) ?? parseTimestamp(log.started_at)
    if (at == null) continue
    const iso = new Date(at).toISOString()
    const prev = out.get(log.project_id)
    if (!prev || at > (parseTimestamp(prev) ?? 0)) {
      out.set(log.project_id, iso)
    }
  }
  return out
}

export function resolveLastActiveAt(
  workLogAt: string | undefined,
  lastPoWakeAt: string | null | undefined,
): string | null {
  return pickLatestIso(workLogAt, lastPoWakeAt ?? null)
}

export function formatRelativeTime(iso: string, locale: string): string {
  const then = parseTimestamp(iso)
  if (then == null) return ''
  const diffSec = Math.round((then - Date.now()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const abs = Math.abs(diffSec)
  if (abs < 60) return rtf.format(diffSec, 'second')
  const diffMin = Math.round(diffSec / 60)
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute')
  const diffHour = Math.round(diffSec / 3600)
  if (Math.abs(diffHour) < 48) return rtf.format(diffHour, 'hour')
  const diffDay = Math.round(diffSec / 86400)
  if (Math.abs(diffDay) < 14) return rtf.format(diffDay, 'day')
  return new Date(then).toLocaleDateString(locale, { dateStyle: 'medium' })
}

/** Secondary line under worker name in sidebar (idle shows last active time). */
export function formatWorkerStatusLabel(
  status: WorkerStatusSnapshot,
  t: TFunction<'nav'>,
  locale: string,
): string {
  const lang = locale.startsWith('nl') ? 'nl' : 'en'

  if (status.primary === 'idle') {
    if (status.hints.lastActiveAt) {
      const time = formatRelativeTime(status.hints.lastActiveAt, locale)
      const translated = t('backgroundWorkers.status.lastActive', { time })
      if (translated !== 'backgroundWorkers.status.lastActive') return translated
      return lang === 'nl' ? `Laatst actief ${time}` : `Last active ${time}`
    }
    const translated = t('backgroundWorkers.status.neverActive')
    if (translated !== 'backgroundWorkers.status.neverActive') return translated
    return lang === 'nl' ? 'Nog niet actief' : 'Not active yet'
  }

  return t(status.primaryKey)
}
