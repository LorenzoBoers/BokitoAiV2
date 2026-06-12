import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Building2,
  Check,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  RefreshCw,
  Search,
  ShieldBan,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import ContentHeader from '../components/shell/ContentHeader'
import {
  getContact,
  getContactThreads,
  listContacts,
  updateContact,
  type ContactRow,
  type ContactStatus,
} from '../lib/contacts-api'
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
    } catch {
      setContact(null)
      setThreads([])
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
    } catch {
      // keep draft
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
    } finally {
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
    <div>
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
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border/55 bg-bg-surface/85 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-text-heading">Profile</h2>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold capitalize ${STATUS_STYLE[contact.status]}`}
            >
              {contact.status}
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
            {threads.length} thread{threads.length === 1 ? '' : 's'} with this contact
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
                  to={`/communication/customers/all/t/${encodeURIComponent(String(t.id))}`}
                  className="group flex items-center gap-2.5 rounded-lg border border-border/45 bg-bg-elevated/45 px-3 py-2 transition-colors hover:border-accent/40"
                >
                  <MessageSquare size={13} className="shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-text-primary">
                      {t.emailSubject || '(No subject)'}
                    </span>
                    <span className="block truncate text-[11px] text-text-muted">
                      {t.status}
                      {t.lastMessageAt ? ` - ${timeAgo(t.lastMessageAt)}` : ''}
                    </span>
                  </span>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

export default function ContactsPage() {
  const { contactId } = useParams<{ contactId?: string }>()
  const { token } = useAuth()
  const navigate = useNavigate()
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const rows = await listContacts(token, search.trim() ? { search: search.trim() } : {})
      setContacts(rows)
    } catch {
      setContacts([])
    } finally {
      setLoading(false)
    }
  }, [token, search])

  useEffect(() => {
    if (contactId) return
    const timer = window.setTimeout(() => void load(), search ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [load, contactId, search])

  const sorted = useMemo(
    () =>
      [...contacts].sort((a, b) => {
        const at = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0
        const bt = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0
        return bt - at
      }),
    [contacts],
  )

  if (contactId) {
    return <ContactDetail contactId={contactId} />
  }

  return (
    <div>
      <ContentHeader
        title="Contacts"
        subtitle="People across your channels"
        meta={
          <button
            type="button"
            onClick={() => void load()}
            className="flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        }
      />

      <div className="mb-4 flex items-center gap-2 rounded-lg border border-border/70 bg-bg-surface px-3 py-2 focus-within:border-accent/50">
        <Search size={14} className="shrink-0 text-text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, address or company..."
          className="w-full bg-transparent text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none"
        />
      </div>

      {loading && contacts.length === 0 ? (
        <div className="flex justify-center pt-16 text-text-muted">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 px-4 py-12 text-center">
          <UserRound size={22} className="mx-auto text-text-muted" />
          <h2 className="mt-3 text-[15px] font-semibold text-text-heading">No contacts yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-text-muted">
            Contacts are created automatically when customers reach out through your channels.
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
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold capitalize ${STATUS_STYLE[contact.status]}`}
                    >
                      {contact.status === 'blocked' ? <ShieldBan size={10} /> : null}
                      {contact.status === 'approved' ? <Check size={10} /> : null}
                      {contact.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
