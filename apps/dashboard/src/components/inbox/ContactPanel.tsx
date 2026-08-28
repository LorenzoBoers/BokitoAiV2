import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard'
import { toast } from 'sonner'
import { Building2, Check, Loader2, Mail, Phone, ShieldBan, Users, UserRound } from 'lucide-react'
import { ChannelGlyph } from '../ui/ChannelGlyph'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { PersonAvatar } from '../ui/PersonAvatar'
import { useAuth } from '../../context/AuthContext'
import {
  findThreadsForContact,
  latestThreadActivityAt,
  resolveContact,
  updateContact,
  type ContactRow,
  type ContactStatus,
} from '../../lib/contacts-api'
import { humanizeContactName, isGenericVisitorName, isPlaceholderContactAddress } from '../../lib/contact-label'
import type { InboxMember, InboxThread, ThreadId } from '../../lib/inbox-api'
import { inboxPath } from '../../lib/messages-paths'
import { canComposeToAddress, composeEmailPath, newContactPath } from '../../lib/compose-intent'
import { useMailboxConnections } from '../../hooks/useMailboxConnections'
import { useMembers } from '../../hooks/useMembers'
import { threadStatusLabel } from '../../lib/status-labels'

function findMemberByAddress(members: InboxMember[], address?: string | null): InboxMember | undefined {
  const email = (address || '').trim().toLowerCase()
  if (!email || !email.includes('@')) return undefined
  return members.find((m) => m.email?.trim().toLowerCase() === email)
}

function roleLabel(
  role: string | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (role === 'owner') return t('contactPanel.roleOwner')
  if (role === 'admin') return t('contactPanel.roleAdmin')
  return t('contactPanel.roleMember')
}

type Props = {
  contactId: string | null
  /** Fallback identity straight from the thread when no contact row exists. */
  fallbackName?: string
  fallbackEmail?: string
  currentThreadId?: ThreadId | null
  threadSubject?: string | null
  threadPreview?: string | null
  onUpdated?: () => void
}

function timeAgo(iso: string | null, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return t('contactPanel.now')
  if (minutes < 60) return t('contactPanel.minutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('contactPanel.hoursAgo', { count: hours })
  return t('contactPanel.daysAgo', { count: Math.floor(hours / 24) })
}

function FieldRow({ icon: Icon, value }: { icon: typeof Mail; value?: string | null }) {
  if (!value) return null
  return (
    <p className="flex items-center gap-2 text-[12.5px]">
      <Icon size={13} className="shrink-0 text-text-muted" />
      <span className="min-w-0 truncate text-text-primary">{value}</span>
    </p>
  )
}

export default function ContactPanel({
  contactId,
  fallbackName,
  fallbackEmail,
  currentThreadId,
  threadSubject,
  threadPreview,
  onUpdated,
}: Props) {
  const { t } = useTranslation('communication')
  const { token, user } = useAuth()
  const { members } = useMembers()
  const { activeConnections } = useMailboxConnections()
  const canSendEmail = activeConnections.length > 0
  const [contact, setContact] = useState<ContactRow | null>(null)
  const [threads, setThreads] = useState<InboxThread[]>([])
  const [loading, setLoading] = useState(true)
  const [notesDraft, setNotesDraft] = useState('')
  const [notesDirty, setNotesDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [captureName, setCaptureName] = useState('')
  const [captureEmail, setCaptureEmail] = useState('')

  const load = useCallback(async () => {
    if (!token) {
      setContact(null)
      setThreads([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const row = await resolveContact(token, {
        id: contactId,
        email: fallbackEmail,
        name: fallbackName,
      })
      setContact(row)
      if (row) {
        try {
          setThreads(await findThreadsForContact(token, row))
        } catch {
          setThreads([])
        }
        setNotesDraft(row.notes ?? '')
        setCaptureName(isGenericVisitorName(row.displayName) ? '' : row.displayName)
        setCaptureEmail(isPlaceholderContactAddress(row.address) ? '' : row.address)
      } else {
        setThreads([])
        setNotesDraft('')
        setCaptureName(fallbackName && !isGenericVisitorName(fallbackName) ? fallbackName : '')
        setCaptureEmail(
          fallbackEmail && !isPlaceholderContactAddress(fallbackEmail) ? fallbackEmail : '',
        )
      }
      setNotesDirty(false)
    } catch (err) {
      setContact(null)
      setThreads([])
      toast.error(formatApiErrorMessage(err, t('contactPanel.loadError')))
    } finally {
      setLoading(false)
    }
  }, [token, contactId, fallbackEmail, fallbackName, t])

  useEffect(() => {
    void load()
  }, [load])

  useUnsavedChangesGuard(notesDirty, t('contactPanel.notesUnsavedLeave'))

  const saveNotes = async () => {
    if (!token || !contact || saving) return
    setSaving(true)
    try {
      const updated = await updateContact(token, contact.id, { notes: notesDraft })
      if (updated) setContact(updated)
      setNotesDirty(false)
      toast.success(t('contactPanel.notesSaved'))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('contactPanel.saveError')))
    } finally {
      setSaving(false)
    }
  }

  const saveIdentity = async () => {
    if (!token || !contact || saving) return
    const email = captureEmail.trim().toLowerCase()
    if (!email || !email.includes('@')) {
      toast.error(t('contactPanel.emailRequired'))
      return
    }
    setSaving(true)
    try {
      const updated = await updateContact(token, contact.id, {
        address: email,
        display_name: captureName.trim() || email.split('@')[0] || contact.displayName,
      })
      if (updated) setContact(updated)
      toast.success(t('contactPanel.emailSaved'))
      onUpdated?.()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('contactPanel.emailSaveError')))
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
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('contactPanel.statusError')))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-4 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('contactPanel.loading')}
      </div>
    )
  }

  const teammate =
    findMemberByAddress(members, contact?.address) ||
    findMemberByAddress(members, fallbackEmail)
  const isSelf =
    Boolean(teammate) &&
    Boolean(user?.email) &&
    teammate!.email.trim().toLowerCase() === user!.email.trim().toLowerCase()

  if (teammate) {
    return (
      <div className="flex flex-col">
        <div className="border-b border-border/40 px-4 pb-3 pt-4">
          <div className="flex items-start gap-2.5">
            <PersonAvatar
              name={teammate.name}
              email={teammate.email}
              size={36}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-semibold text-text-heading">
                {teammate.name || teammate.email}
              </p>
              <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-accent/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-accent">
                <Users size={9} />
                {isSelf ? t('contactPanel.you') : t('contactPanel.teammate')}
              </span>
              <p className="mt-1 truncate text-[11.5px] text-text-muted">
                {roleLabel(teammate.role, t)}
              </p>
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            <FieldRow icon={Mail} value={teammate.email} />
          </div>
          <p className="mt-2 text-[11px] text-text-muted">{t('contactPanel.teammateHint')}</p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Link
              to="/settings/members"
              className="inline-flex shrink-0 items-center whitespace-nowrap rounded-md border border-border/60 px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60"
            >
              {t('contactPanel.openMembers')}
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!contact) {
    const readableEmail =
      fallbackEmail && !isPlaceholderContactAddress(fallbackEmail) ? fallbackEmail : ''
    return (
      <div className="px-4 py-4">
        <div className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center">
          <UserRound size={18} className="mx-auto text-text-muted" />
          <p className="mt-2 text-[12.5px] font-medium text-text-primary">
            {humanizeContactName(fallbackName, fallbackEmail, t('contactPanel.widgetVisitor')) ||
              t('contactPanel.noContact')}
          </p>
          {readableEmail ? <p className="text-[11.5px] text-text-muted">{readableEmail}</p> : null}
          <p className="mt-2 text-[11px] text-text-muted">
            {t('contactPanel.noContactHint')}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {readableEmail ? (
              <Link
                to={newContactPath(readableEmail)}
                className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-fg hover:bg-accent-hover"
              >
                {t('contactPanel.addContact')}
              </Link>
            ) : null}
            {readableEmail && canSendEmail && canComposeToAddress('email', readableEmail) ? (
              <Link
                to={composeEmailPath({ to: readableEmail })}
                className="rounded-md border border-border/60 px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover/60"
              >
                {t('contactPanel.writeEmail')}
              </Link>
            ) : null}
            <Link
              to="/contacts"
              className="rounded-md border border-border/60 px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover/60"
            >
              {t('contactPanel.openContacts')}
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const previousThreads = threads.filter(
    (row) => String(row.id) !== String(currentThreadId ?? ''),
  )

  return (
    <div className="flex flex-col">
      {/* Identity card */}
      <div className="border-b border-border/40 px-4 pb-3 pt-4">
        <div className="flex items-start gap-2.5">
          <PersonAvatar name={contact.displayName} email={contact.address} size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold text-text-heading">
              {humanizeContactName(contact.displayName, contact.address, t('contactPanel.widgetVisitor')) ||
                // A real address is a better headline than "unknown contact".
                (!isPlaceholderContactAddress(contact.address) && contact.address) ||
                t('contactPanel.unknown')}
            </p>
            <span
              className={`mt-0.5 inline-flex rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide ${
                contact.status === 'blocked'
                  ? 'bg-status-error/12 text-status-error'
                  : contact.status === 'pending'
                    ? 'bg-status-warning/15 text-status-warning'
                    : 'bg-status-success/12 text-status-success'
              }`}
            >
              {contact.status === 'blocked'
                ? t('contactPanel.statusBlocked')
                : contact.status === 'pending'
                  ? t('contactPanel.statusPending')
                  : t('contactPanel.statusApproved')}
            </span>
            {contact.title || contact.company ? (
              <p className="truncate text-[11.5px] text-text-muted">
                {[contact.title, contact.company].filter(Boolean).join(' - ')}
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          <FieldRow
            icon={Mail}
            value={
              isPlaceholderContactAddress(contact.address)
                ? t('contactPanel.widgetVisitor')
                : contact.address
            }
          />
          <FieldRow icon={Phone} value={contact.phone} />
          {contact.company ? (
            <Link
              to={
                contact.companyId
                  ? `/contacts/companies/${contact.companyId}`
                  : `/contacts?q=${encodeURIComponent(contact.company)}`
              }
              className="flex items-center gap-2 text-[12.5px] text-text-primary hover:text-accent"
            >
              <Building2 size={13} className="shrink-0 text-text-muted" />
              <span className="min-w-0 truncate">{contact.company}</span>
            </Link>
          ) : null}
        </div>
        {contact.lastSeenAt || latestThreadActivityAt(threads) ? (
          <p className="mt-2 text-[11px] text-text-muted">
            {t('contactPanel.lastSeen', {
              time: timeAgo(contact.lastSeenAt || latestThreadActivityAt(threads), t),
            })}
          </p>
        ) : null}
        {isPlaceholderContactAddress(contact.address) ? (
          <form
            className="mt-3 space-y-2 rounded-md border border-border/50 bg-bg-elevated/40 px-2.5 py-2"
            onSubmit={(e) => {
              e.preventDefault()
              void saveIdentity()
            }}
          >
            <p className="text-[11px] text-text-muted">{t('contactPanel.askForEmail')}</p>
            <input
              type="text"
              value={captureName}
              onChange={(e) => setCaptureName(e.target.value)}
              placeholder={t('contactPanel.namePlaceholder')}
              className="w-full rounded-md border border-border/60 bg-bg-surface px-2 py-1 text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
            <input
              type="email"
              value={captureEmail}
              onChange={(e) => setCaptureEmail(e.target.value)}
              placeholder={t('contactPanel.emailPlaceholder')}
              className="w-full rounded-md border border-border/60 bg-bg-surface px-2 py-1 text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50"
            >
              {saving ? t('contactPanel.saving') : t('contactPanel.saveEmail')}
            </button>
          </form>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {contact.status === 'pending' ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void setStatus('approved')}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border/60 px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-status-success disabled:opacity-50"
            >
              <Check size={11} />
              {t('contactPanel.approve')}
            </button>
          ) : null}
          {contact.status !== 'blocked' ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                const name = contact.displayName || contact.address || t('contactPanel.thisContact')
                if (window.confirm(t('contactPanel.blockConfirm', { name }))) {
                  void setStatus('blocked')
                }
              }}
              title={t('contactPanel.block')}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border/60 px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-status-error disabled:opacity-50"
            >
              <ShieldBan size={11} />
              {t('contactPanel.block')}
            </button>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={() => void setStatus('approved')}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border/60 px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-status-success disabled:opacity-50"
            >
              <Check size={11} />
              {t('contactPanel.unblock')}
            </button>
          )}
          {canSendEmail && canComposeToAddress(contact.channel, contact.address) ? (
            <Link
              to={composeEmailPath({
                to: contact.address,
                subject: threadSubject?.trim()
                  ? /^re:/i.test(threadSubject) ? threadSubject : `Re: ${threadSubject}`
                  : undefined,
              })}
              title={t('contactPanel.writeEmail')}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border/60 px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
            >
              <Mail size={11} />
              {t('contactPanel.writeEmail')}
            </Link>
          ) : null}
          <Link
            to={`/contacts/${contact.id}`}
            className="ml-auto inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-1.5 py-1 text-[11px] font-medium text-accent hover:underline"
          >
            {t('contactPanel.fullProfile')}
          </Link>
        </div>
      </div>

      {/* Notes */}
      <div className="border-b border-border/40 px-4 py-3">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{t('contactPanel.notes')}</h3>
        <textarea
          value={notesDraft}
          onChange={(e) => {
            setNotesDraft(e.target.value)
            setNotesDirty(true)
          }}
          rows={3}
          placeholder={t('contactPanel.notesPlaceholder')}
          className="w-full resize-none rounded-md border border-border bg-bg-surface px-2.5 py-2 text-[12.5px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
        />
        {notesDirty ? (
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveNotes()}
              className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              <Check size={11} />
              {saving ? t('contactPanel.saving') : t('contactPanel.saveNotes')}
            </button>
            <span className="text-[11px] text-status-warning">{t('contactPanel.notesUnsaved')}</span>
          </div>
        ) : null}
      </div>

      {/* Previous conversations */}
      <div className="px-4 py-3">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          {t('contactPanel.previous')}
        </h3>
        {previousThreads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 px-3 py-3 space-y-1.5">
            <p className="text-[11.5px] text-text-muted">{t('contactPanel.noPrevious')}</p>
            {contactId ? (
              <Link
                to={`/contacts/${contactId}`}
                className="inline-block text-[11px] font-medium text-accent hover:underline"
              >
                {t('contactPanel.openContacts')}
              </Link>
            ) : (
              <Link
                to="/contacts"
                className="inline-block text-[11px] font-medium text-accent hover:underline"
              >
                {t('contactPanel.openContacts')}
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {previousThreads.slice(0, 8).map((thread) => (
              <Link
                key={String(thread.id)}
                to={inboxPath('open', String(thread.id))}
                className="flex items-center gap-2 rounded-lg border border-border/40 bg-bg-elevated/45 px-2.5 py-1.5 transition-colors hover:border-accent/40"
              >
                <ChannelGlyph channel={thread.channel ?? 'email'} size={12} className="shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-text-primary">
                    {thread.emailSubject || t('contactPanel.noSubject')}
                  </span>
                  <span className="block truncate text-[10.5px] text-text-muted">
                    {threadStatusLabel(thread.status, t)}
                    {thread.lastMessageAt ? ` - ${timeAgo(thread.lastMessageAt, t)}` : ''}
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
