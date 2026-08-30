import { integrationsRoutes } from '../api/routes'
import { apiDelete, apiGet, apiPatch, apiPost } from './api'

export type CalendarConnection = {
  id: string
  provider: string
  display_name: string
  status: string
  last_synced_at?: string | null
  sync_status?: string
  sync_error?: string
  event_count?: number
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

export async function createCalendarEvent(input: {
  connection_id: string
  title: string
  start_at: string
  end_at: string
  description?: string
  location?: string
}): Promise<{ event: { id: string; external_id?: string; html_link?: string } }> {
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
  },
): Promise<{ event: { id: string; external_id?: string; html_link?: string } }> {
  return apiPatch(integrationsRoutes.platform.calendars.eventById(eventId), input)
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  await apiDelete(integrationsRoutes.platform.calendars.eventById(eventId))
}
