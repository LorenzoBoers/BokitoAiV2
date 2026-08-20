import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Building2,
  Check,
  Loader2,
  Mail,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  ShieldBan,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { useAuth } from '../context/AuthContext'
import ContentHeader from '../components/shell/ContentHeader'
import { PageContent } from '../components/layout/PageContent'
import {
  backfillCompanies,
  createContact,
  deleteCompany,
  deleteContact,
  getCompany,
  getContact,
  getContactThreads,
  listCompanies,
  listContacts,
  updateCompany,
  updateContact,
  type CompanyDetail as CompanyDetailData,
  type CompanyRow,
  type ContactRow,
  type ContactStatus,
} from '../lib/contacts-api'
import { humanizeLabel } from '../lib/labels'
import { inboxPath } from '../lib/messages-paths'
import type { InboxThread } from '../lib/inbox-api'

const STATUS_STYLE: Record<ContactStatus, string> = {
  approved: 'bg-status-success/15 text-status-success',
  pending: 'bg-status-warning/15 text-status-warning',
  blocked: 'bg-status-error/15 text-status-error',
}

const CHANNEL_LABELS: Record<string, string> = {
  email: 'Email',
  widget: 'Widget',
  slack: 'Slack',
  internal: 'Internal',
}

function timeAgo(iso: string | null): string {
  if (!iso) return '-'
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function ContactDetail({ contactId }: { contactId: string }) {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [contact, setContact] = useState<ContactRow | null>(null)
  const [threads, setThreads] = useState<InboxThread[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState({ displayName: '', company: '', title: '', phone: '', notes: '' })
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const [row, history] = await Promise.all([
        getContact(token, contactId),
        getContactThreads(token, contactId),
      ])
      setContact(row)
      setThreads(history)
      if (row) {
        setDraft({
          displayName: row.displayName,
          company: row.company,
          title: row.title,
          phone: row.phone,
          notes: row.notes,
        })
      }
      setDirty(false)
    } catch (err) {
      setContact(null)
      setThreads([])
      toast.error(formatApiErrorMessage(err, 'Could not load contact.'))
    } finally {
      setLoading(false)
    }
  }, [token, contactId])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!token || !contact || saving) return
    setSaving(true)
    try {
      const updated = await updateContact(token, contact.id, {
        display_name: draft.displayName,
        company: draft.company,
        title: draft.title,
        phone: draft.phone,
        notes: draft.notes,
      })
      if (updated) setContact(updated)
      setDirty(false)
      toast.success('Contact saved')
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not save contact.'))
    } finally {
      setSaving(false)
    }
  }

  const setStatus = async (status: ContactStatus) => {
    if (!token || !contact || saving) return
    setSaving(true)
    try {
      const updated = await updateContact(token, contact.id, { status })
      if (updated) setContact((prev) => (prev ? { ...prev, status: updated.status } : updated))
      toast.success(status === 'blocked' ? 'Contact blocked' : status === 'approved' ? 'Contact approved' : 'Status updated')
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not update contact status.'))
    } finally {
      setSaving(false)
    }
  }

  const removeContact = async () => {
    if (!token || !contact || saving) return
    const label = contact.displayName || contact.address || 'this contact'
    if (!window.confirm(`Delete ${label}? Conversations are kept but unlinked.`)) return
    setSaving(true)
    try {
      await deleteContact(token, contact.id)
      toast.success('Contact deleted')
      navigate('/contacts')
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not delete contact.'))
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center pt-16 text-text-muted">
        <Loader2 size={18} className="animate-spin" />
      </div>
    )
  }

  if (!contact) {
    return (
      <div className="pt-10 text-center">
        <p className="text-sm text-text-muted">Contact not found.</p>
        <button
          type="button"
          onClick={() => navigate('/contacts')}
          className="mt-3 text-sm font-medium text-accent hover:underline"
        >
          Back to contacts
        </button>
      </div>
    )
  }

  const field = (label: string, key: keyof typeof draft, placeholder: string) => (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</span>
      <input
        value={draft[key]}
        onChange={(e) => {
          setDraft((prev) => ({ ...prev, [key]: e.target.value }))
          setDirty(true)
        }}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-border bg-bg-surface px-2.5 py-1.5 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
      />
    </label>
  )

  return (
    <PageContent width="xl">
      <ContentHeader
        title={contact.displayName || contact.address || 'Contact'}
        subtitle={[contact.title, contact.company].filter(Boolean).join(' - ') || CHANNEL_LABELS[contact.channel] || contact.channel}
        meta={
          <>
            <Link
              to="/contacts"
              className="flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60"
            >
              <ArrowLeft size={12} />
              All contacts
            </Link>
            {contact.status !== 'approved' ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void setStatus('approved')}
                className="flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-status-success disabled:opacity-50"
              >
                <ShieldCheck size={12} />
                Approve
              </button>
            ) : null}
            {contact.status !== 'blocked' ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void setStatus('blocked')}
                className="flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-status-error disabled:opacity-50"
              >
                <ShieldBan size={12} />
                Block
              </button>
            ) : null}
            <button
              type="button"
              disabled={saving}
              onClick={() => void removeContact()}
              className="flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:border-status-error/50 hover:text-status-error disabled:opacity-50"
            >
              <Trash2 size={12} />
              Delete
            </button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border/55 bg-bg-surface/85 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-text-heading">Profile</h2>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${STATUS_STYLE[contact.status]}`}
            >
              {humanizeLabel(contact.status)}
            </span>
          </div>
          <div className="mt-3 space-y-3">
            <p className="flex items-center gap-2 text-[12.5px] text-text-secondary">
              <Mail size={13} className="text-text-muted" />
              {contact.address || 'No address'}
              <span className="ml-auto text-[11px] text-text-muted">
                {CHANNEL_LABELS[contact.channel] ?? contact.channel}
              </span>
            </p>
            {field('Name', 'displayName', 'Full name')}
            <div className="grid grid-cols-2 gap-3">
              {field('Company', 'company', 'Company')}
              {field('Title', 'title', 'Role / title')}
            </div>
            {contact.companyId ? (
              <Link
                to={`/contacts/companies/${contact.companyId}`}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent hover:underline"
              >
                <Building2 size={12} />
                View company record
              </Link>
            ) : null}
            {field('Phone', 'phone', 'Phone number')}
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Notes</span>
              <textarea
                value={draft.notes}
                onChange={(e) => {
                  setDraft((prev) => ({ ...prev, notes: e.target.value }))
                  setDirty(true)
                }}
                rows={4}
                placeholder="Internal notes about this contact..."
                className="mt-1 w-full resize-none rounded-md border border-border bg-bg-surface px-2.5 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
              />
            </label>
            {dirty ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                <Check size={12} />
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            ) : null}
          </div>
        </section>

        <section className="rounded-xl border border-border/55 bg-bg-surface/85 p-4">
          <h2 className="text-[14px] font-semibold text-text-heading">Conversations</h2>
          <p className="text-[12px] text-text-muted">
            {threads.length === 1
              ? '1 thread with this contact'
              : `${threads.length} threads with this contact`}
          </p>
          <div className="mt-3 space-y-1.5">
            {threads.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-[12px] text-text-muted">
                No conversations yet.
              </p>
            ) : (
              threads.map((t) => (
                <Link
                  key={String(t.id)}
                  to={inboxPath('all', String(t.id))}
                  className="group flex items-center gap-2.5 rounded-lg border border-border/45 bg-bg-elevated/45 px-3 py-2 transition-colors hover:border-accent/40"
                >
                  <MessageSquare size={13} className="shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-text-primary">
                      {t.emailSubject || '(No subject)'}
                    </span>
                    <span className="block truncate text-[11px] text-text-muted">
                      {humanizeLabel(t.status)}
                      {t.lastMessageAt ? ` - ${timeAgo(t.lastMessageAt)}` : ''}
                    </span>
                  </span>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>
    </PageContent>
  )
}

function CompanyDetailView({ companyId }: { companyId: string }) {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [company, setCompany] = useState<CompanyDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState({ name: '', website: '', notes: '' })
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const row = await getCompany(token, companyId)
      setCompany(row)
      if (row) setDraft({ name: row.name, website: row.website, notes: row.notes })
      setDirty(false)
    } catch (err) {
      setCompany(null)
      toast.error(formatApiErrorMessage(err, 'Could not load company.'))
    } finally {
      setLoading(false)
    }
  }, [token, companyId])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!token || !company || saving) return
    setSaving(true)
    try {
      const updated = await updateCompany(token, company.id, {
        name: draft.name,
        website: draft.website,
        notes: draft.notes,
      })
      if (updated) setCompany((prev) => (prev ? { ...prev, ...updated } : prev))
      setDirty(false)
      toast.success('Company saved')
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not save company.'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!token || !company || saving) return
    if (!window.confirm(`Delete ${company.name || company.domain}? Contacts are kept but unlinked.`)) return
    setSaving(true)
    try {
      await deleteCompany(token, company.id)
      toast.success('Company deleted')
      navigate('/contacts')
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not delete company.'))
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center pt-16 text-text-muted">
        <Loader2 size={18} className="animate-spin" />
      </div>
    )
  }

  if (!company) {
    return (
      <div className="pt-10 text-center">
        <p className="text-sm text-text-muted">Company not found.</p>
        <button
          type="button"
          onClick={() => navigate('/contacts')}
          className="mt-3 text-sm font-medium text-accent hover:underline"
        >
          Back to contacts
        </button>
      </div>
    )
  }

  const field = (label: string, key: keyof typeof draft, placeholder: string) => (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</span>
      <input
        value={draft[key]}
        onChange={(e) => {
          setDraft((prev) => ({ ...prev, [key]: e.target.value }))
          setDirty(true)
        }}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-border bg-bg-surface px-2.5 py-1.5 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
      />
    </label>
  )

  return (
    <PageContent width="xl">
      <ContentHeader
        title={company.name || company.domain}
        subtitle={`${company.domain} - ${company.contactCount} contact${company.contactCount === 1 ? '' : 's'}`}
        meta={
          <>
            <Link
              to="/contacts"
              className="flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60"
            >
              <ArrowLeft size={12} />
              All contacts
            </Link>
            <button
              type="button"
              disabled={saving}
              onClick={() => void remove()}
              className="flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:border-status-error/50 hover:text-status-error disabled:opacity-50"
            >
              <Trash2 size={12} />
              Delete
            </button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border/55 bg-bg-surface/85 p-4">
          <h2 className="text-[14px] font-semibold text-text-heading">Company</h2>
          <div className="mt-3 space-y-3">
            {field('Name', 'name', 'Company name')}
            {field('Website', 'website', 'https://...')}
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Notes</span>
              <textarea
                value={draft.notes}
                onChange={(e) => {
                  setDraft((prev) => ({ ...prev, notes: e.target.value }))
                  setDirty(true)
                }}
                rows={4}
                placeholder="Internal notes about this company..."
                className="mt-1 w-full resize-none rounded-md border border-border bg-bg-surface px-2.5 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
              />
            </label>
            {dirty ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                <Check size={12} />
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            ) : null}
          </div>

          <h3 className="mt-5 text-[13px] font-semibold text-text-heading">People</h3>
          <div className="mt-2 space-y-1.5">
            {company.contacts.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-[12px] text-text-muted">
                No linked contacts.
              </p>
            ) : (
              company.contacts.map((c) => (
                <Link
                  key={c.id}
                  to={`/contacts/${c.id}`}
                  className="flex items-center gap-2.5 rounded-lg border border-border/45 bg-bg-elevated/45 px-3 py-2 transition-colors hover:border-accent/40"
                >
                  <UserRound size={13} className="shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-text-primary">
                      {c.displayName || c.address}
                    </span>
                    <span className="block truncate text-[11px] text-text-muted">{c.address}</span>
                  </span>
                </Link>
              ))
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border/55 bg-bg-surface/85 p-4">
          <h2 className="text-[14px] font-semibold text-text-heading">Conversations</h2>
          <p className="text-[12px] text-text-muted">Recent threads across this company's contacts</p>
          <div className="mt-3 space-y-1.5">
            {company.threads.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-[12px] text-text-muted">
                No conversations yet.
              </p>
            ) : (
              company.threads.map((t) => (
                <Link
                  key={String(t.id)}
                  to={inboxPath('all', String(t.id))}
                  className="group flex items-center gap-2.5 rounded-lg border border-border/45 bg-bg-elevated/45 px-3 py-2 transition-colors hover:border-accent/40"
                >
                  <MessageSquare size={13} className="shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-text-primary">
                      {t.emailSubject || '(No subject)'}
                    </span>
                    <span className="block truncate text-[11px] text-text-muted">
                      {humanizeLabel(t.status)}
                      {t.lastMessageAt ? ` - ${timeAgo(t.lastMessageAt)}` : ''}
                    </span>
                  </span>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>
    </PageContent>
  )
}

const STATUS_FILTERS: ReadonlyArray<{ key: ContactStatus | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'approved', label: 'Approved' },
  { key: 'pending', label: 'Pending' },
  { key: 'blocked', label: 'Blocked' },
]

export default function ContactsPage() {
  const { contactId, companyId } = useParams<{ contactId?: string; companyId?: string }>()
  const { token } = useAuth()
  const navigate = useNavigate()
  const [view, setView] = useState<'people' | 'companies'>('people')
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ContactStatus | 'all'>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [createDraft, setCreateDraft] = useState({ address: '', displayName: '', company: '' })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [backfilling, setBackfilling] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setListError(null)
    try {
      if (view === 'companies') {
        const rows = await listCompanies(token, {
          ...(search.trim() ? { search: search.trim() } : {}),
        })
        setCompanies(rows)
      } else {
        const rows = await listContacts(token, {
          ...(search.trim() ? { search: search.trim() } : {}),
          ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        })
        setContacts(rows)
      }
    } catch (err) {
      setContacts([])
      setCompanies([])
      setListError(err instanceof Error ? err.message : 'Could not load contacts.')
    } finally {
      setLoading(false)
    }
  }, [token, search, statusFilter, view])

  useEffect(() => {
    if (contactId || companyId) return
    const timer = window.setTimeout(() => void load(), search ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [load, contactId, companyId, search])

  const handleBackfill = async () => {
    if (!token || backfilling) return
    setBackfilling(true)
    try {
      const result = await backfillCompanies(token)
      toast.success(
        result.linked > 0
          ? `Linked ${result.linked} contact${result.linked === 1 ? '' : 's'} to companies.`
          : 'All contacts are already linked.',
      )
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not link contacts.'))
    } finally {
      setBackfilling(false)
    }
  }

  const handleCreate = async () => {
    if (!token || creating) return
    const address = createDraft.address.trim()
    if (!address) {
      setCreateError('Email address is required.')
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const created = await createContact(token, {
        channel: 'email',
        address,
        display_name: createDraft.displayName.trim(),
        company: createDraft.company.trim(),
      })
      setCreateOpen(false)
      setCreateDraft({ address: '', displayName: '', company: '' })
      toast.success('Contact created')
      if (created) navigate(`/contacts/${created.id}`)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create contact.')
    } finally {
      setCreating(false)
    }
  }

  const sorted = useMemo(
    () =>
      [...contacts].sort((a, b) => {
        const at = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0
        const bt = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0
        return bt - at
      }),
    [contacts],
  )

  if (companyId) {
    return <CompanyDetailView companyId={companyId} />
  }

  if (contactId) {
    return <ContactDetail contactId={contactId} />
  }

  return (
    <PageContent width="xl">
      <ContentHeader
        title="Contacts"
        subtitle="People and companies across your channels"
        meta={
          <>
            <button
              type="button"
              onClick={() => void load()}
              className="flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            {view === 'companies' ? (
              <button
                type="button"
                disabled={backfilling}
                onClick={() => void handleBackfill()}
                className="flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 disabled:opacity-50"
              >
                {backfilling ? <Loader2 size={12} className="animate-spin" /> : <Building2 size={12} />}
                Link contacts
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-hover"
              >
                <Plus size={12} />
                New contact
              </button>
            )}
          </>
        }
      />

      <div className="mb-3 flex items-center gap-2 rounded-lg border border-border/70 bg-bg-surface px-3 py-2 focus-within:border-accent/50">
        <Search size={14} className="shrink-0 text-text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={
            view === 'companies'
              ? 'Search by company name or domain...'
              : 'Search by name, address or company...'
          }
          className="w-full bg-transparent text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none"
        />
      </div>

      <div className="mb-4 flex items-center gap-1.5">
        <div className="mr-2 flex items-center rounded-lg border border-border/60 p-0.5">
          {(['people', 'companies'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={
                view === v
                  ? 'rounded-md bg-accent/15 px-2.5 py-1 text-[12px] font-medium text-accent'
                  : 'rounded-md px-2.5 py-1 text-[12px] text-text-secondary hover:text-text-primary'
              }
            >
              {v === 'people' ? 'People' : 'Companies'}
            </button>
          ))}
        </div>
        {view === 'people'
          ? STATUS_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setStatusFilter(f.key)}
                className={
                  statusFilter === f.key
                    ? 'rounded-full bg-accent/15 px-2.5 py-0.5 text-[12px] font-medium text-accent'
                    : 'rounded-full bg-bg-hover/60 px-2.5 py-0.5 text-[12px] text-text-secondary hover:text-text-primary'
                }
              >
                {f.label}
              </button>
            ))
          : null}
      </div>

      {createOpen ? (
        <div className="mb-4 rounded-xl border border-border/60 bg-bg-surface/90 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-text-heading">New contact</h2>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setCreateOpen(false)}
              className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-text-primary"
            >
              <X size={14} />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <input
              value={createDraft.address}
              onChange={(e) => setCreateDraft((p) => ({ ...p, address: e.target.value }))}
              placeholder="Email address *"
              className="rounded-md border border-border bg-bg-surface px-2.5 py-1.5 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
            <input
              value={createDraft.displayName}
              onChange={(e) => setCreateDraft((p) => ({ ...p, displayName: e.target.value }))}
              placeholder="Full name"
              className="rounded-md border border-border bg-bg-surface px-2.5 py-1.5 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
            <input
              value={createDraft.company}
              onChange={(e) => setCreateDraft((p) => ({ ...p, company: e.target.value }))}
              placeholder="Company"
              className="rounded-md border border-border bg-bg-surface px-2.5 py-1.5 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
          </div>
          {createError ? <p className="mt-2 text-[12px] text-status-error">{createError}</p> : null}
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              disabled={creating || !createDraft.address.trim()}
              onClick={() => void handleCreate()}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {creating ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              {creating ? 'Creating...' : 'Create contact'}
            </button>
          </div>
        </div>
      ) : null}

      {loading && (view === 'companies' ? companies.length === 0 : contacts.length === 0) ? (
        <div className="flex justify-center pt-16 text-text-muted">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : listError ? (
        <div className="rounded-xl border border-dashed border-status-error/40 px-4 py-12 text-center">
          <UserRound size={22} className="mx-auto text-text-muted" />
          <h2 className="mt-3 text-[15px] font-semibold text-text-heading">Could not load contacts</h2>
          <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-text-muted">{listError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 rounded-lg border border-border/60 px-3 py-1.5 text-[12px] font-medium text-text-secondary hover:border-accent/40 hover:text-text-primary"
          >
            Try again
          </button>
        </div>
      ) : view === 'companies' ? (
        companies.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 px-4 py-12 text-center">
            <Building2 size={22} className="mx-auto text-text-muted" />
            <h2 className="mt-3 text-[15px] font-semibold text-text-heading">
              {search.trim() ? 'No matching companies' : 'No companies yet'}
            </h2>
            <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-text-muted">
              {search.trim()
                ? 'Try a different search.'
                : 'Companies are created automatically from business email domains. Use "Link contacts" to backfill existing contacts.'}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/55 bg-bg-surface/85">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border/50 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-2.5">Company</th>
                  <th className="hidden px-4 py-2.5 sm:table-cell">Domain</th>
                  <th className="hidden px-4 py-2.5 md:table-cell">Website</th>
                  <th className="px-4 py-2.5 text-right">Contacts</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((company) => (
                  <tr
                    key={company.id}
                    onClick={() => navigate(`/contacts/companies/${company.id}`)}
                    className="cursor-pointer border-b border-border/35 transition-colors last:border-b-0 hover:bg-bg-hover/45"
                  >
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent">
                          <Building2 size={13} />
                        </span>
                        <span className="truncate text-[13px] font-medium text-text-primary">
                          {company.name || company.domain}
                        </span>
                      </span>
                    </td>
                    <td className="hidden px-4 py-2.5 text-[12.5px] text-text-secondary sm:table-cell">
                      {company.domain}
                    </td>
                    <td className="hidden px-4 py-2.5 text-[12.5px] text-text-secondary md:table-cell">
                      {company.website || '-'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[12.5px] text-text-secondary">
                      {company.contactCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 px-4 py-12 text-center">
          <UserRound size={22} className="mx-auto text-text-muted" />
          <h2 className="mt-3 text-[15px] font-semibold text-text-heading">
            {search.trim() || statusFilter !== 'all' ? 'No matching contacts' : 'No contacts yet'}
          </h2>
          <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-text-muted">
            {search.trim() || statusFilter !== 'all'
              ? 'Try a different search or clear the status filter.'
              : 'Contacts are created automatically when customers reach out through your channels.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/55 bg-bg-surface/85">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border/50 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                <th className="px-4 py-2.5">Name</th>
                <th className="hidden px-4 py-2.5 sm:table-cell">Channel</th>
                <th className="hidden px-4 py-2.5 md:table-cell">Company</th>
                <th className="hidden px-4 py-2.5 lg:table-cell">Last seen</th>
                <th className="px-4 py-2.5 text-right">Threads</th>
                <th className="px-4 py-2.5 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((contact) => (
                <tr
                  key={contact.id}
                  onClick={() => navigate(`/contacts/${contact.id}`)}
                  className="cursor-pointer border-b border-border/35 transition-colors last:border-b-0 hover:bg-bg-hover/45"
                >
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/12 text-[11.5px] font-semibold text-accent">
                        {(contact.displayName || contact.address || '?').slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-text-primary">
                          {contact.displayName || contact.address || 'Unknown'}
                        </span>
                        <span className="block truncate text-[11px] text-text-muted">{contact.address}</span>
                      </span>
                    </span>
                  </td>
                  <td className="hidden px-4 py-2.5 text-[12.5px] text-text-secondary sm:table-cell">
                    {CHANNEL_LABELS[contact.channel] ?? contact.channel}
                  </td>
                  <td className="hidden px-4 py-2.5 md:table-cell">
                    {contact.company ? (
                      <span className="flex items-center gap-1.5 text-[12.5px] text-text-secondary">
                        <Building2 size={12} className="text-text-muted" />
                        {contact.company}
                      </span>
                    ) : (
                      <span className="text-[12px] text-text-muted">-</span>
                    )}
                  </td>
                  <td className="hidden px-4 py-2.5 text-[12.5px] text-text-secondary lg:table-cell">
                    {timeAgo(contact.lastSeenAt)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[12.5px] text-text-secondary">
                    {contact.threadCount}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${STATUS_STYLE[contact.status]}`}
                    >
                      {contact.status === 'blocked' ? <ShieldBan size={10} /> : null}
                      {contact.status === 'approved' ? <Check size={10} /> : null}
                      {humanizeLabel(contact.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageContent>
  )
}
