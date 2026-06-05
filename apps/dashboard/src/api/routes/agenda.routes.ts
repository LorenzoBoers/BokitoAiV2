import { withQuery } from '../url'

export const agendaRoutes = {
  calendars: '/agenda/calendars',
  calendar: (id: string) => `/agenda/calendars/${id}`,
  connect: (provider: 'google' | 'outlook') => `/agenda/calendars/connect/${provider}`,
  connectComplete: (provider: 'google' | 'outlook') => `/agenda/calendars/connect/${provider}/complete`,
  eventsQuery: (params: URLSearchParams) => withQuery('/agenda/events', params),
  events: '/agenda/events',
  event: (id: string) => `/agenda/events/${id}`,
  eventRun: (id: string) => `/agenda/events/${id}/run`,
} as const
