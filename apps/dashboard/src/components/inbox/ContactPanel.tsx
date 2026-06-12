import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, Check, Loader2, Mail, MessageSquare, Phone, ShieldBan, ShieldCheck, UserRound } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import {
  getContact,
  getContactThreads,
  updateContact,
  type ContactRow,
  type ContactStatus,
} from '../../lib/contacts-api'
import type { InboxThread, ThreadId } from '../../lib/inbox-api'

type Props = {
  contactId: string | null
  /** Fallback identity straight from the thread when no contact row exists. */
  fallbackName?: string
  fallbackEmail?: string
  currentThreadId?: ThreadId | null
}

const STATUS_STYLE: Record<ContactStatus, string> = {
  approved: 'bg-status-success/15 text-status-success',
  pending: 'bg-status-warning/15 text-status-warning',
  blocked: 'bg-status-error/15 text-status-error',
}

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function FieldRow({ icon: Icon, value, placeholder }: { icon: typeof Mail; value: string; placeholder: string }) {
  return (
    <p className="flex items-center gap-2 text-[12.5px]">
      <Icon size={13} className="shrink-0 text-text-muted" />
      {value ? (
        <span className="min-w-0 truncate text-text-primary">{value}</span>
      ) : (
        <span className="text-text-muted">{placeholder}</span>
      )}
    </p>
  )
}

export default function ContactPanel({ contactId, fallbackName, fallbackEmail, currentThreadId }: Props) {
  const { token } = useAuth()
  const [contact, setContact] = useState<ContactRow | null>(null)
  const [threads, setThreads] = useState<InboxThread[]>([])
  const [loading, setLoading] = useState(true)
  const [notesDraft, setNotesDraft] = useState('')
  const [notesDirty, setNotesDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!token || !contactId) {
      setContact(null)
      setThreads([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [row, history] = await Promise.all([
        getContact(token, contactId),
        getContactThreads(token, contactId),
      ])
      setContact(row)
      setThreads(history)
      setNotesDraft(row?.notes ?? '')
      setNotesDirty(false)
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

  const saveNotes = async () => {
    if (!token || !contact || saving) return
    setSaving(true)
    try {
      const updated = await updateContact(token, contact.id, { notes: notesDraft })
      if (updated) setContact(updated)
      setNotesDirty(false)
    } catch {
      // keep draft for retry
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
    } catch {
      // non-fatal
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-4 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading contact...
      </div>
    )
  }

  if (!contact) {
    return (
      <div className="px-4 py-4">
        <div className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center">
          <UserRound size={18} className="mx-auto text-text-muted" />
          <p className="mt-2 text-[12.5px] font-medium text-text-primary">
            {fallbackName || 'No contact linked'}
          </p>
          {fallbackEmail ? <p className="text-[11.5px] text-text-muted">{fallbackEmail}</p> : null}
          <p className="mt-2 text-[11px] text-text-muted">
            This thread has no CRM contact yet. A contact is created automatically on the next
            inbound message.
          </p>
        </div>
      </div>
    )
  }

  const previousThreads = threads.filter(
    (t) => String(t.id) !== String(currentThreadId ?? ''),
  )

  return (
    <div className="flex flex-col">
      {/* Identity card */}
      <div className="border-b border-border/40 px-4 pb-3 pt-4">
        <div className="flex items-start gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/12 text-[13px] font-semibold text-accent">
            {(contact.displayName || contact.address || '?').slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold text-text-heading">
              {contact.displayName || contact.address || 'Unknown contact'}
            </p>
            {contact.title || contact.company ? (
              <p className="truncate text-[11.5px] text-text-muted">
                {[contact.title, contact.company].filter(Boolean).join(' - ')}
              </p>
            ) : null}
            <span
              className={`mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-semibold capitalize ${STATUS_STYLE[contact.status]}`}
            >
              {contact.status}
            </span>
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          <FieldRow icon={Mail} value={contact.address} placeholder="No address" />
          <FieldRow icon={Phone} value={contact.phone} placeholder="No phone" />
          <FieldRow icon={Building2} value={contact.company} placeholder="No company" />
        </div>
        {contact.lastSeenAt ? (
          <p className="mt-2 text-[11px] text-text-muted">Last seen {timeAgo(contact.lastSeenAt)}</p>
        ) : null}
        <div className="mt-3 flex gap-1.5">
          {contact.status !== 'approved' ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void setStatus('approved')}
              className="flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-status-success disabled:opacity-50"
            >
              <ShieldCheck size={11} />
              Approve
            </button>
          ) : null}
          {contact.status !== 'blocked' ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void setStatus('blocked')}
              className="flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-status-error disabled:opacity-50"
            >
              <ShieldBan size={11} />
              Block
            </button>
          ) : null}
          <Link
            to={`/contacts/${contact.id}`}
            className="ml-auto flex items-center rounded-md px-2 py-1 text-[11px] font-medium text-accent hover:underline"
          >
            Full profile
          </Link>
        </div>
      </div>

      {/* Notes */}
      <div className="border-b border-border/40 px-4 py-3">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Notes</h3>
        <textarea
          value={notesDraft}
          onChange={(e) => {
            setNotesDraft(e.target.value)
            setNotesDirty(true)
          }}
          rows={3}
          placeholder="Internal notes about this contact..."
          className="w-full resize-none rounded-md border border-border bg-bg-surface px-2.5 py-2 text-[12.5px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
        />
        {notesDirty ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveNotes()}
            className="mt-1.5 flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            <Check size={11} />
            {saving ? 'Saving...' : 'Save notes'}
          </button>
        ) : null}
      </div>

      {/* Previous conversations */}
      <div className="px-4 py-3">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          Previous conversations
        </h3>
        {previousThreads.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/50 px-3 py-3 text-[11.5px] text-text-muted">
            No other conversations with this contact.
          </p>
        ) : (
          <div className="space-y-1">
            {previousThreads.slice(0, 8).map((t) => (
              <Link
                key={String(t.id)}
                to={`/communication/customers/all/t/${encodeURIComponent(String(t.id))}`}
                className="flex items-center gap-2 rounded-lg border border-border/45 bg-bg-elevated/45 px-2.5 py-1.5 transition-colors hover:border-accent/40"
              >
                <MessageSquare size={12} className="shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-text-primary">
                    {t.emailSubject || '(No subject)'}
                  </span>
                  <span className="block truncate text-[10.5px] text-text-muted">
                    {t.status}
                    {t.lastMessageAt ? ` - ${timeAgo(t.lastMessageAt)}` : ''}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
