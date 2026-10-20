import type { ContactStatus } from './contacts-api'

export type ContactsStatusFilter = ContactStatus | 'all'

const STATUSES = new Set<ContactStatus>(['approved', 'pending', 'blocked'])

export function parseContactsStatus(raw: string | null): ContactsStatusFilter {
  return raw && STATUSES.has(raw as ContactStatus) ? (raw as ContactStatus) : 'all'
}

/** Write one list filter into the query. Empty / `all` removes the key. */
export function withContactsParam(params: URLSearchParams, key: string, value: string | null): URLSearchParams {
  const next = new URLSearchParams(params)
  const current = next.get(key) ?? ''
  const incoming = value && value !== 'all' ? value : ''
  if (current === incoming) return params
  if (incoming) next.set(key, incoming)
  else next.delete(key)
  return next
}
