import { agendaRoutes } from '../api/routes/agenda.routes'
import {
  xanoDeleteAgenda,
  xanoGetAgenda,
  xanoPatchAgenda,
  xanoPostAgenda,
} from './xano'

export type AgendaCalendar = {
  id: string
  tenantId: string
  name: string
  kind: 'user' | 'orchestrator' | 'team' | 'external'
  color: string
  isSystem: boolean
  externalProvider: string | null
  externalConnectionId: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type AgendaEvent = {
  id: string
  masterId: string
  tenantId: string
  calendarId: string | null
  kind: 'user' | 'orchestrator' | 'implementation' | 'external'
  title: string
  description: string
  location: string
  startsAt: string
  endsAt: string | null
  allDay: boolean
  timezone: string
  status: string
  priority: string
  assignedToUserId: string | null
  recurrenceFreq: string
  recurrenceInterval: number
  recurrenceUntil: string | null
  prompt: string
  agentRole: string
  enabled: boolean
  nextRunAt: string | null
  lastRunAt: string | null
  readOnly: boolean
  isOccurrence: boolean
}

export type AgendaView = 'month' | 'week' | 'day' | 'list'

export type EventFilters = {
  start: string
  end: string
  calendarIds?: string[]
}

export type EventCreateInput = {
  calendarId: string
  kind?: string
  title: string
  description?: string
  location?: string
  startsAt: string
  endsAt?: string | null
  allDay?: boolean
  timezone?: string
  status?: string
  priority?: string
  recurrenceFreq?: string
  recurrenceInterval?: number
  recurrenceUntil?: string | null
  prompt?: string
  agentRole?: string
  enabled?: boolean
}

export type EventPatchInput = Partial<EventCreateInput>

function normalizeCalendar(raw: Record<string, unknown>): AgendaCalendar {
  return {
    id: String(raw.id),
    tenantId: String(raw.tenant_id ?? raw.tenantId),
    name: String(raw.name ?? ''),
    kind: (raw.kind as AgendaCalendar['kind']) || 'user',
    color: String(raw.color ?? '#6366f1'),
    isSystem: Boolean(raw.is_system ?? raw.isSystem),
    externalProvider: (raw.external_provider ?? raw.externalProvider) as string | null,
    externalConnectionId: (raw.external_connection_id ?? raw.externalConnectionId) as string | null,
    createdAt: (raw.created_at ?? raw.createdAt) as string | null,
    updatedAt: (raw.updated_at ?? raw.updatedAt) as string | null,
  }
}

function normalizeEvent(raw: Record<string, unknown>): AgendaEvent {
  return {
    id: String(raw.id),
    masterId: String(raw.master_id ?? raw.masterId ?? raw.id),
    tenantId: String(raw.tenant_id ?? raw.tenantId),
    calendarId: (raw.calendar_id ?? raw.calendarId) as string | null,
    kind: (raw.kind as AgendaEvent['kind']) || 'user',
    title: String(raw.title ?? ''),
    description: String(raw.description ?? ''),
    location: String(raw.location ?? ''),
    startsAt: String(raw.starts_at ?? raw.startsAt ?? ''),
    endsAt: (raw.ends_at ?? raw.endsAt) as string | null,
    allDay: Boolean(raw.all_day ?? raw.allDay),
    timezone: String(raw.timezone ?? 'UTC'),
    status: String(raw.status ?? 'confirmed'),
    priority: String(raw.priority ?? 'normal'),
    assignedToUserId: (raw.assigned_to_user_id ?? raw.assignedToUserId) as string | null,
    recurrenceFreq: String(raw.recurrence_freq ?? raw.recurrenceFreq ?? 'none'),
    recurrenceInterval: Number(raw.recurrence_interval ?? raw.recurrenceInterval ?? 1),
    recurrenceUntil: (raw.recurrence_until ?? raw.recurrenceUntil) as string | null,
    prompt: String(raw.prompt ?? ''),
    agentRole: String(raw.agent_role ?? raw.agentRole ?? 'orchestra'),
    enabled: Boolean(raw.enabled ?? true),
    nextRunAt: (raw.next_run_at ?? raw.nextRunAt) as string | null,
    lastRunAt: (raw.last_run_at ?? raw.lastRunAt) as string | null,
    readOnly: Boolean(raw.read_only ?? raw.readOnly),
    isOccurrence: Boolean(raw.is_occurrence ?? raw.isOccurrence),
  }
}

function toSnakeCreate(body: EventCreateInput): Record<string, unknown> {
  return {
    calendar_id: body.calendarId,
    kind: body.kind,
    title: body.title,
    description: body.description,
    location: body.location,
    starts_at: body.startsAt,
    ends_at: body.endsAt,
    all_day: body.allDay,
    timezone: body.timezone,
    status: body.status,
    priority: body.priority,
    recurrence_freq: body.recurrenceFreq,
    recurrence_interval: body.recurrenceInterval,
    recurrence_until: body.recurrenceUntil,
    prompt: body.prompt,
    agent_role: body.agentRole,
    enabled: body.enabled,
  }
}

function toSnakePatch(body: EventPatchInput): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (body.calendarId != null) out.calendar_id = body.calendarId
  if (body.title != null) out.title = body.title
  if (body.description != null) out.description = body.description
  if (body.location != null) out.location = body.location
  if (body.startsAt != null) out.starts_at = body.startsAt
  if (body.endsAt !== undefined) out.ends_at = body.endsAt
  if (body.allDay != null) out.all_day = body.allDay
  if (body.timezone != null) out.timezone = body.timezone
  if (body.status != null) out.status = body.status
  if (body.priority != null) out.priority = body.priority
  if (body.recurrenceFreq != null) out.recurrence_freq = body.recurrenceFreq
  if (body.recurrenceInterval != null) out.recurrence_interval = body.recurrenceInterval
  if (body.recurrenceUntil !== undefined) out.recurrence_until = body.recurrenceUntil
  if (body.prompt != null) out.prompt = body.prompt
  if (body.agentRole != null) out.agent_role = body.agentRole
  if (body.enabled != null) out.enabled = body.enabled
  return out
}

export async function listCalendars(token?: string): Promise<AgendaCalendar[]> {
  const rows = await xanoGetAgenda<Record<string, unknown>[]>(agendaRoutes.calendars, token)
  return (Array.isArray(rows) ? rows : []).map((r) => normalizeCalendar(r))
}

export async function createCalendar(
  name: string,
  token?: string,
  opts?: { kind?: string; color?: string },
): Promise<AgendaCalendar> {
  const row = await xanoPostAgenda<Record<string, unknown>>(
    agendaRoutes.calendars,
    { name, kind: opts?.kind ?? 'user', color: opts?.color ?? '#6366f1' },
    token,
  )
  return normalizeCalendar(row)
}

export async function listEvents(filters: EventFilters, token?: string): Promise<AgendaEvent[]> {
  const params = new URLSearchParams({ start: filters.start, end: filters.end })
  if (filters.calendarIds?.length) {
    params.set('calendar_ids', filters.calendarIds.join(','))
  }
  const body = await xanoGetAgenda<{ items?: Record<string, unknown>[] }>(
    agendaRoutes.eventsQuery(params),
    token,
  )
  const items = body?.items ?? []
  return items.map((r) => normalizeEvent(r))
}

export async function getEvent(eventId: string, token?: string): Promise<AgendaEvent> {
  const row = await xanoGetAgenda<Record<string, unknown>>(agendaRoutes.event(eventId), token)
  return normalizeEvent(row)
}

export async function createEvent(body: EventCreateInput, token?: string): Promise<AgendaEvent> {
  const row = await xanoPostAgenda<Record<string, unknown>>(
    agendaRoutes.events,
    toSnakeCreate(body),
    token,
  )
  return normalizeEvent(row)
}

export async function patchEvent(
  eventId: string,
  body: EventPatchInput,
  token?: string,
): Promise<AgendaEvent> {
  const row = await xanoPatchAgenda<Record<string, unknown>>(
    agendaRoutes.event(eventId),
    toSnakePatch(body),
    token,
  )
  return normalizeEvent(row)
}

export async function deleteEvent(eventId: string, token?: string): Promise<void> {
  await xanoDeleteAgenda(agendaRoutes.event(eventId), token)
}

export async function runOrchestratorEvent(eventId: string, token?: string): Promise<{ run_id: string }> {
  return xanoPostAgenda<{ run_id: string }>(agendaRoutes.eventRun(eventId), {}, token)
}

export async function startExternalCalendarConnect(
  provider: 'google' | 'outlook',
  returnUrl: string,
  token?: string,
): Promise<{ authorize_url: string }> {
  const params = new URLSearchParams({ return_url: returnUrl })
  return xanoGetAgenda<{ authorize_url: string }>(
    `${agendaRoutes.connect(provider)}?${params.toString()}`,
    token,
  )
}

export async function completeExternalCalendarConnect(
  provider: 'google' | 'outlook',
  token?: string,
): Promise<AgendaCalendar> {
  const row = await xanoPostAgenda<Record<string, unknown>>(
    agendaRoutes.connectComplete(provider),
    {},
    token,
  )
  return normalizeCalendar(row)
}
