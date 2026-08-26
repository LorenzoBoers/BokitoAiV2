/** CRM contacts API (channel contacts with profile fields and thread history). */

import { appRoutes } from '../api/routes/app.routes'
import { apiDelete, apiGet, apiPatch, apiPost } from './api'
import { isGenericVisitorName, isPlaceholderContactAddress } from './contact-label'
import type { InboxThread } from './inbox-api'
import { normalizeThreadRow } from './inbox-api'
import { listSignalThreads } from './signals-api'

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
  try {
    const payload = await apiGet<unknown>(appRoutes.contacts.byId(contactId), token)
    const row = normalizeContact(payload)
    if (row) return row
  } catch {
    // Some local rows 404 on GET while still appearing in the list (mixed UUID
    // text formats). Fall back so opening a contact from the table still works.
  }
  const listed = await listContacts(token)
  const compact = compactRecordId(contactId)
  return (
    listed.find((contact) => contact.id === contactId || compactRecordId(contact.id) === compact) ??
    null
  )
}

export async function getContactThreads(token: string, contactId: string): Promise<InboxThread[]> {
  const payload = await apiGet<{ threads?: unknown[] }>(appRoutes.contacts.threads(contactId), token)
  const rows = Array.isArray(payload.threads) ? payload.threads : []
  return rows.map(normalizeThreadRow).filter((t): t is InboxThread => t !== null)
}

export function compactRecordId(value: string): string {
  return value.replace(/-/g, '').toLowerCase()
}

/** Match a Communication thread to a contact when the CRM thread API 404s. */
export function contactMatchesIdentity(
  contact: Pick<ContactRow, 'id' | 'address' | 'displayName'>,
  identity: { id?: string | null; email?: string | null; name?: string | null },
): boolean {
  if (identity.id && compactRecordId(identity.id) === compactRecordId(contact.id)) return true
  const email = (identity.email ?? '').trim().toLowerCase()
  if (email && contact.address.trim().toLowerCase() === email) return true
  const name = (identity.name ?? '').trim().toLowerCase()
  if (name && contact.displayName.trim().toLowerCase() === name) return true
  return false
}

/** Resolve a CRM row from a thread even when contactId is missing or 404s. */
export async function resolveContact(
  token: string,
  identity: { id?: string | null; email?: string | null; name?: string | null },
): Promise<ContactRow | null> {
  if (identity.id) {
    const row = await getContact(token, identity.id)
    if (row) return row
  }
  const listed = await listContacts(token)
  return listed.find((contact) => contactMatchesIdentity(contact, identity)) ?? null
}

export function threadMatchesContact(
  thread: Pick<InboxThread, 'contactId' | 'contactEmail' | 'contactName'>,
  contact: Pick<ContactRow, 'id' | 'address' | 'displayName'>,
): boolean {
  if (thread.contactId && compactRecordId(thread.contactId) === compactRecordId(contact.id)) {
    return true
  }
  const address = contact.address.trim().toLowerCase()
  if (address && thread.contactEmail.trim().toLowerCase() === address) return true
  const name = contact.displayName.trim().toLowerCase()
  if (name && thread.contactName.trim().toLowerCase() === name) return true
  return false
}

export function latestThreadActivityAt(threads: Array<{ lastMessageAt: string | null }>): string | null {
  let latest: string | null = null
  for (const thread of threads) {
    if (!thread.lastMessageAt) continue
    if (!latest || thread.lastMessageAt > latest) latest = thread.lastMessageAt
  }
  return latest
}

/**
 * List-row matching: id and real email always win. Display name is only used
 * when it is unique in the CRM list, so generic "Website visitor" rows do not
 * inherit every widget thread.
 */
export function threadMatchesContactForList(
  thread: Pick<InboxThread, 'contactId' | 'contactEmail' | 'contactName'>,
  contact: Pick<ContactRow, 'id' | 'address' | 'displayName'>,
  options: { allowNameMatch: boolean },
): boolean {
  if (thread.contactId && compactRecordId(thread.contactId) === compactRecordId(contact.id)) {
    return true
  }
  const address = contact.address.trim().toLowerCase()
  if (
    address &&
    !isPlaceholderContactAddress(contact.address) &&
    thread.contactEmail.trim().toLowerCase() === address
  ) {
    return true
  }
  if (!options.allowNameMatch || isGenericVisitorName(contact.displayName)) return false
  const name = contact.displayName.trim().toLowerCase()
  return Boolean(name) && thread.contactName.trim().toLowerCase() === name
}

/** Fill last-seen and thread counts from Communication when the CRM fields are empty. */
export function enrichContactsFromThreads(contacts: ContactRow[], threads: InboxThread[]): ContactRow[] {
  const nameCounts = new Map<string, number>()
  for (const contact of contacts) {
    const name = contact.displayName.trim().toLowerCase()
    if (!name || isGenericVisitorName(name)) continue
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1)
  }

  return contacts.map((contact) => {
    const name = contact.displayName.trim().toLowerCase()
    const allowNameMatch = Boolean(name) && !isGenericVisitorName(name) && (nameCounts.get(name) ?? 0) === 1
    const matched = threads.filter((thread) =>
      threadMatchesContactForList(thread, contact, { allowNameMatch }),
    )
    if (matched.length === 0) return contact
    const lastSeen = latestThreadActivityAt(matched)
    return {
      ...contact,
      threadCount: Math.max(contact.threadCount, matched.length),
      lastSeenAt:
        lastSeen && (!contact.lastSeenAt || lastSeen > contact.lastSeenAt) ? lastSeen : contact.lastSeenAt,
    }
  })
}

function sortThreadsByActivity(threads: InboxThread[]): InboxThread[] {
  return [...threads].sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
}

/**
 * Contact-thread GET can 404 on mixed UUID text. Fall back to inbox search
 * so a person who already has conversations is not shown as empty.
 */
export async function findThreadsForContact(token: string, contact: ContactRow): Promise<InboxThread[]> {
  try {
    const direct = await getContactThreads(token, contact.id)
    if (direct.length > 0) return sortThreadsByActivity(direct)
  } catch {
    // UUID mismatch or missing contact-thread route — use inbox search.
  }

  const queries = [contact.address.trim(), contact.displayName.trim()].filter(Boolean)
  const seen = new Set<string>()
  const matched: InboxThread[] = []

  const consume = (items: InboxThread[]) => {
    for (const thread of items) {
      const id = String(thread.id)
      if (seen.has(id) || !threadMatchesContact(thread, contact)) continue
      seen.add(id)
      matched.push(thread)
    }
  }

  for (const query of queries) {
    try {
      const page = await listSignalThreads(token, { search: query, perPage: 50 })
      consume(page.items)
    } catch {
      // Keep trying other queries / the unfiltered page.
    }
  }

  if (matched.length === 0) {
    try {
      const page = await listSignalThreads(token, { perPage: 50 })
      consume(page.items)
    } catch {
      return []
    }
  }

  return sortThreadsByActivity(matched)
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
