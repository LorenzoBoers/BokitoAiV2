import { integrationsRoutes } from '../api/routes'
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from './api'
import { startIntegrationOAuth } from './integrations-api'
import { connectedPathWithKind } from './integration-kind-url'

/** One calendar inside an account (Google calendarList / Graph calendars). */
export type CalendarInfo = {
  id: string
  name: string
  color: string
  primary: boolean
  writable: boolean
  enabled: boolean
}

export type CalendarSyncStatus = 'ok' | 'idle' | 'error' | 'reconnect'

export type CalendarConnection = {
  id: string
  provider: string
  display_name: string
  /** Signed-in account (email) when known. */
  account?: string
  status: string
  last_synced_at?: string | null
  sync_status?: CalendarSyncStatus | string
  sync_error?: string
  event_count?: number
  calendars?: CalendarInfo[]
  default_write_calendar?: string | null
  access_level?: 'use' | 'manage'
  can_manage?: boolean
}

export const CALENDAR_PROVIDERS = ['google_calendar', 'outlook_calendar'] as const
export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number]

export function calendarBrandSlug(provider: string): string {
  const slug = provider.trim().toLowerCase()
  if (slug.includes('outlook') || slug.includes('microsoft')) return 'outlook-calendar'
  if (slug.includes('google')) return 'google-calendar'
  return slug || 'calendar'
}

/** Backend timestamps are naive UTC. */
export function utcIso(value: string | null | undefined): string | null {
  if (!value) return null
  return /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`
}

export async function listCalendarConnections(): Promise<CalendarConnection[]> {
  const data = await apiGet<{ connections: CalendarConnection[] }>(
    integrationsRoutes.platform.calendars.connections,
  )
  return data.connections ?? []
}

export async function syncAllCalendars(): Promise<unknown> {
  return apiPost(integrationsRoutes.platform.calendars.syncAll, {})
}

export async function syncCalendarConnection(connectionId: string): Promise<unknown> {
  return apiPost(integrationsRoutes.platform.calendars.syncOne(connectionId), {})
}

export type AccountCalendars = {
  calendars: CalendarInfo[]
  default_write_calendar: string | null
}

/** Fresh list from Google or Microsoft (requires Manage). */
export async function listAccountCalendars(connectionId: string): Promise<AccountCalendars> {
  return apiGet(integrationsRoutes.platform.calendars.accountCalendars(connectionId))
}

export async function saveAccountCalendars(
  connectionId: string,
  input: {
    calendars?: Array<{ id: string; enabled: boolean }>
    default_write_calendar?: string
  },
): Promise<AccountCalendars> {
  return apiPut(integrationsRoutes.platform.calendars.accountCalendars(connectionId), input)
}

/** Send the browser to Google or Microsoft. Signing in with an account that is
 * already connected refreshes it; another account becomes a new connection. */
export async function startCalendarConnect(provider: CalendarProvider): Promise<void> {
  const returnUrl = new URL(connectedPathWithKind('calendar'), window.location.origin).toString()
  const { authorize_url } = await startIntegrationOAuth(provider, returnUrl)
  window.location.assign(authorize_url)
}

export async function createCalendarEvent(input: {
  connection_id: string
  calendar_id?: string
  title: string
  start_at: string
  end_at: string
  description?: string
  location?: string
  all_day?: boolean
}): Promise<{ event: { id: string; external_id?: string; html_link?: string; calendar_id?: string } }> {
  return apiPost(integrationsRoutes.platform.calendars.events, input)
}

export async function updateCalendarEvent(
  eventId: string,
  input: {
    title?: string
    start_at?: string
    end_at?: string
    description?: string
    location?: string
    all_day?: boolean
  },
): Promise<{ event: { id: string; external_id?: string; html_link?: string } }> {
  return apiPatch(integrationsRoutes.platform.calendars.eventById(eventId), input)
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  await apiDelete(integrationsRoutes.platform.calendars.eventById(eventId))
}

/** The meeting as a conversation dated at the meeting (same thread on repeat calls). */
export async function openCalendarEventThread(eventId: string): Promise<string> {
  const res = await apiPost<{ signal_id: string }>(integrationsRoutes.platform.calendars.eventThread(eventId), {})
  return res.signal_id
}
