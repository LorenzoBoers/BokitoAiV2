/** CRM contacts API (channel contacts with profile fields and thread history). */

import { appRoutes } from '../api/routes/app.routes'
import { apiGet, apiPatch } from './api'
import type { InboxThread } from './inbox-api'
import { normalizeThreadRow } from './inbox-api'

export type ContactStatus = 'approved' | 'pending' | 'blocked'

export type ContactRow = {
  id: string
  channel: string
  address: string
  displayName: string
  status: ContactStatus
  company: string
  title: string
  phone: string
  notes: string
  lastSeenAt: string | null
  createdAt: string
  threadCount: number
}

export type ContactPatch = {
  status?: ContactStatus
  display_name?: string
  company?: string
  title?: string
  phone?: string
  notes?: string
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function normalizeContact(row: unknown): ContactRow | null {
  if (!row || typeof row !== 'object') return null
  const raw = row as Record<string, unknown>
  const id = asString(raw.id)
  if (!id) return null
  const statusValue = asString(raw.status)
  const status: ContactStatus =
    statusValue === 'pending' ? 'pending' : statusValue === 'blocked' ? 'blocked' : 'approved'
  return {
    id,
    channel: asString(raw.channel),
    address: asString(raw.address),
    displayName: asString(raw.display_name),
    status,
    company: asString(raw.company),
    title: asString(raw.title),
    phone: asString(raw.phone),
    notes: asString(raw.notes),
    lastSeenAt: asString(raw.last_seen_at) || null,
    createdAt: asString(raw.created_at),
    threadCount: typeof raw.thread_count === 'number' ? raw.thread_count : 0,
  }
}

export async function listContacts(
  token: string,
  options: { search?: string; status?: ContactStatus; channel?: string } = {},
): Promise<ContactRow[]> {
  const params = new URLSearchParams()
  if (options.search) params.set('search', options.search)
  if (options.status) params.set('status', options.status)
  if (options.channel) params.set('channel', options.channel)
  const payload = await apiGet<{ contacts?: unknown[] }>(appRoutes.contacts.listQuery(params), token)
  const rows = Array.isArray(payload.contacts) ? payload.contacts : []
  return rows.map(normalizeContact).filter((c): c is ContactRow => c !== null)
}

export async function getContact(token: string, contactId: string): Promise<ContactRow | null> {
  const payload = await apiGet<unknown>(appRoutes.contacts.byId(contactId), token)
  return normalizeContact(payload)
}

export async function getContactThreads(token: string, contactId: string): Promise<InboxThread[]> {
  const payload = await apiGet<{ threads?: unknown[] }>(appRoutes.contacts.threads(contactId), token)
  const rows = Array.isArray(payload.threads) ? payload.threads : []
  return rows.map(normalizeThreadRow).filter((t): t is InboxThread => t !== null)
}

export async function updateContact(
  token: string,
  contactId: string,
  patch: ContactPatch,
): Promise<ContactRow | null> {
  const payload = await apiPatch<unknown>(appRoutes.contacts.byId(contactId), patch, token)
  return normalizeContact(payload)
}
