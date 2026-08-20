/** CRM contacts API (channel contacts with profile fields and thread history). */

import { appRoutes } from '../api/routes/app.routes'
import { apiDelete, apiGet, apiPatch, apiPost } from './api'
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
  companyId: string | null
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
    companyId: asString(raw.company_id) || null,
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

export type ContactCreateInput = {
  channel?: string
  address: string
  display_name?: string
  company?: string
  title?: string
  phone?: string
  notes?: string
}

export async function createContact(
  token: string,
  input: ContactCreateInput,
): Promise<ContactRow | null> {
  const payload = await apiPost<unknown>(appRoutes.contacts.list, input, token)
  return normalizeContact(payload)
}

export async function deleteContact(token: string, contactId: string): Promise<void> {
  await apiDelete<unknown>(appRoutes.contacts.byId(contactId), token)
}

// ── companies (CRM) ──────────────────────────────────────────────────

export type CompanyRow = {
  id: string
  name: string
  domain: string
  website: string
  notes: string
  contactCount: number
  createdAt: string
  updatedAt: string
}

export type CompanyDetail = CompanyRow & {
  contacts: ContactRow[]
  threads: InboxThread[]
}

function normalizeCompany(row: unknown): CompanyRow | null {
  if (!row || typeof row !== 'object') return null
  const raw = row as Record<string, unknown>
  const id = asString(raw.id)
  if (!id) return null
  return {
    id,
    name: asString(raw.name),
    domain: asString(raw.domain),
    website: asString(raw.website),
    notes: asString(raw.notes),
    contactCount: typeof raw.contact_count === 'number' ? raw.contact_count : 0,
    createdAt: asString(raw.created_at),
    updatedAt: asString(raw.updated_at),
  }
}

export async function listCompanies(
  token: string,
  options: { search?: string } = {},
): Promise<CompanyRow[]> {
  const params = new URLSearchParams()
  if (options.search) params.set('search', options.search)
  const payload = await apiGet<{ companies?: unknown[] }>(
    appRoutes.companies.listQuery(params),
    token,
  )
  const rows = Array.isArray(payload.companies) ? payload.companies : []
  return rows.map(normalizeCompany).filter((c): c is CompanyRow => c !== null)
}

export async function getCompany(token: string, companyId: string): Promise<CompanyDetail | null> {
  const payload = await apiGet<Record<string, unknown>>(appRoutes.companies.byId(companyId), token)
  const base = normalizeCompany(payload)
  if (!base) return null
  const contacts = Array.isArray(payload.contacts)
    ? payload.contacts.map(normalizeContact).filter((c): c is ContactRow => c !== null)
    : []
  const threads = Array.isArray(payload.threads)
    ? payload.threads.map(normalizeThreadRow).filter((t): t is InboxThread => t !== null)
    : []
  return { ...base, contacts, threads }
}

export async function updateCompany(
  token: string,
  companyId: string,
  patch: Partial<{ name: string; website: string; notes: string }>,
): Promise<CompanyRow | null> {
  const payload = await apiPatch<unknown>(appRoutes.companies.byId(companyId), patch, token)
  return normalizeCompany(payload)
}

export async function deleteCompany(token: string, companyId: string): Promise<void> {
  await apiDelete<unknown>(appRoutes.companies.byId(companyId), token)
}

export async function backfillCompanies(token: string): Promise<{ linked: number }> {
  return apiPost<{ linked: number }>(appRoutes.companies.backfill, {}, token)
}
