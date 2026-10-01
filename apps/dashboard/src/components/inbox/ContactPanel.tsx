import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard'
import { toast } from 'sonner'
import { Building2, Check, Loader2, Mail, Phone, ShieldBan, Users, UserRound } from 'lucide-react'
import { ChannelGlyph } from '../ui/ChannelGlyph'
import { ThreadStatusDot } from '../ui/ThreadStatusDot'
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
import {
  humanizeContactName,
  isAnonymousContact,
  isGenericVisitorName,
  isPlaceholderContactAddress,
} from '../../lib/contact-label'
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
    <p className="flex items-center gap-2 text-sm">
      <Icon size={13} className="shrink-0 text-text-muted" />
      <span className="min-w-0 truncate-fade text-text-primary">{value}</span>
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
              <p className="truncate-fade text-base font-semibold text-text-heading">
                {teammate.name || teammate.email}
              </p>
              <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-accent/10 px-1.5 py-px text-2xs font-semibold text-accent">
                <Users size={9} />
                {isSelf ? t('contactPanel.you') : t('contactPanel.teammate')}
              </span>
              <p className="mt-1 truncate-fade text-xs text-text-muted">
                {roleLabel(teammate.role, t)}
              </p>
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            <FieldRow icon={Mail} value={teammate.email} />
          </div>
          <p className="mt-2 text-xs text-text-muted">{t('contactPanel.teammateHint')}</p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Link
              to="/settings/members"
              className="inline-flex shrink-0 items-center whitespace-nowrap rounded-md border border-border/60 px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover/60"
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
          <p className="mt-2 text-sm font-medium text-text-primary">
            {humanizeContactName(fallbackName, fallbackEmail, t('contactPanel.widgetVisitor')) ||
              t('contactPanel.noContact')}
          </p>
          {readableEmail ? <p className="text-xs text-text-muted">{readableEmail}</p> : null}
          <p className="mt-2 text-xs text-text-muted">
            {t('contactPanel.noContactHint')}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {readableEmail ? (
              <Link
                to={newContactPath(readableEmail)}
                className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:bg-accent-hover"
              >
                {t('contactPanel.addContact')}
              </Link>
            ) : null}
            {readableEmail && canSendEmail && canComposeToAddress('email', readableEmail) ? (
              <Link
                to={composeEmailPath({ to: readableEmail })}
                className="rounded-md border border-border/60 px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover/60"
              >
                {t('contactPanel.writeEmail')}
              </Link>
            ) : null}
            <Link
              to="/contacts"
              className="rounded-md border border-border/60 px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover/60"
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

  const anonymous = isAnonymousContact(contact.displayName, contact.address)
  const headlineName =
    humanizeContactName(contact.displayName, contact.address, t('contactPanel.widgetVisitor')) ||
    (!isPlaceholderContactAddress(contact.address) && contact.address) ||
    t('contactPanel.unknown')
  const namedHeadline =
    Boolean(headlineName) &&
    headlineName.trim().toLowerCase() !== t('contactPanel.widgetVisitor').trim().toLowerCase()
  // Legacy rows may still be "approved" without an email — treat as awaiting identity.
  const statusPending = contact.status === 'pending' || (anonymous && contact.status === 'approved')
  const alsoSeenAsVisitor =
    namedHeadline &&
    (isPlaceholderContactAddress(contact.address) ||
      isGenericVisitorName(contact.displayName) ||
      (fallbackName != null && isGenericVisitorName(fallbackName)))

  return (
    <div className="flex flex-col">
      {/* Identity card — panel chrome already titles this as Who */}
      <div className="border-b border-border/40 px-4 pb-3 pt-3">
        <div className="flex items-start gap-2.5">
          <PersonAvatar name={contact.displayName} email={contact.address} size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate-fade text-base font-semibold text-text-heading">{headlineName}</p>
            <span
              className={`mt-0.5 inline-flex rounded-full px-1.5 py-px text-2xs font-semibold ${
                contact.status === 'blocked'
                  ? 'bg-status-error/12 text-status-error'
                  : statusPending
                    ? 'bg-status-warning/15 text-status-warning'
                    : 'bg-status-success/12 text-status-success'
              }`}
            >
              {contact.status === 'blocked'
                ? t('contactPanel.statusBlocked')
                : statusPending
                  ? anonymous
                    ? t('contactPanel.statusAwaitingEmail')
                    : t('contactPanel.statusPending')
                  : t('contactPanel.statusApproved')}
            </span>
            {contact.title || contact.company ? (
              <p className="truncate-fade text-xs text-text-muted">
                {[contact.title, contact.company].filter(Boolean).join(' - ')}
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          {!isPlaceholderContactAddress(contact.address) &&
          contact.address.trim().toLowerCase() !== String(headlineName).trim().toLowerCase() ? (
            <FieldRow icon={Mail} value={contact.address} />
          ) : null}
          {alsoSeenAsVisitor ? (
            <p className="flex items-center gap-2 text-xs text-text-muted">
              <ChannelGlyph channel={contact.channel || 'widget'} size={13} className="shrink-0" />
              <span className="min-w-0 truncate-fade">
                {t('contactPanel.alsoSeenAs', { label: t('contactPanel.widgetVisitor') })}
              </span>
            </p>
          ) : null}
          <FieldRow icon={Phone} value={contact.phone} />
          {contact.company ? (
            <Link
              to={
                contact.companyId
                  ? `/contacts/companies/${contact.companyId}`
                  : `/contacts?q=${encodeURIComponent(contact.company)}`
              }
              className="flex items-center gap-2 text-sm text-text-primary hover:text-accent"
            >
              <Building2 size={13} className="shrink-0 text-text-muted" />
              <span className="min-w-0 truncate-fade">{contact.company}</span>
            </Link>
          ) : null}
        </div>
        {contact.lastSeenAt || latestThreadActivityAt(threads) ? (
          <p className="mt-2 text-xs text-text-muted">
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
            <p className="text-xs text-text-muted">{t('contactPanel.askForEmail')}</p>
            <input
              type="text"
              value={captureName}
              onChange={(e) => setCaptureName(e.target.value)}
              placeholder={t('contactPanel.namePlaceholder')}
              className="w-full rounded-md border border-border/60 bg-bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
            <input
              type="email"
              value={captureEmail}
              onChange={(e) => setCaptureEmail(e.target.value)}
              placeholder={t('contactPanel.emailPlaceholder')}
              className="w-full rounded-md border border-border/60 bg-bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50"
            >
              {saving ? t('contactPanel.saving') : t('contactPanel.saveEmail')}
            </button>
          </form>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {statusPending && !anonymous ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void setStatus('approved')}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border/60 px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-status-success disabled:opacity-50"
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
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border/60 px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-status-error disabled:opacity-50"
            >
              <ShieldBan size={11} />
              {t('contactPanel.block')}
            </button>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={() => void setStatus('approved')}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border/60 px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-status-success disabled:opacity-50"
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
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border/60 px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
            >
              <Mail size={11} />
              {t('contactPanel.writeEmail')}
            </Link>
          ) : null}
          <Link
            to={`/contacts/${contact.id}`}
            className="ml-auto inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-medium text-accent hover:underline"
          >
            {t('contactPanel.fullProfile')}
          </Link>
        </div>
      </div>

      {/* Notes */}
      <div className="border-b border-border/40 px-4 py-3">
        <h3 className="mb-2 text-xs font-semibold text-text-muted">{t('contactPanel.notes')}</h3>
        <textarea
          value={notesDraft}
          onChange={(e) => {
            setNotesDraft(e.target.value)
            setNotesDirty(true)
          }}
          rows={3}
          placeholder={t('contactPanel.notesPlaceholder')}
          className="w-full resize-none rounded-md border border-border bg-bg-surface px-2.5 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
        />
        {notesDirty ? (
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveNotes()}
              className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              <Check size={11} />
              {saving ? t('contactPanel.saving') : t('contactPanel.saveNotes')}
            </button>
            <span className="text-xs text-status-warning">{t('contactPanel.notesUnsaved')}</span>
          </div>
        ) : null}
      </div>

      {/* Previous conversations (Who — history with this person) */}
      <div className="border-b border-border/40 px-4 py-3">
        <h3 className="mb-2 text-xs font-semibold text-text-muted">
          {t('contactPanel.previous')}
        </h3>
        {previousThreads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 px-3 py-3 space-y-1.5">
            <p className="text-xs text-text-muted">{t('contactPanel.noPrevious')}</p>
            <p className="text-xs text-text-muted/90">
              {isGenericVisitorName(contact?.displayName || fallbackName) ||
              isPlaceholderContactAddress(contact?.address || fallbackEmail)
                ? t('contactPanel.noPreviousVisitorHint')
                : t('contactPanel.noPreviousHint')}
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {contact?.address && canSendEmail && canComposeToAddress(contact.channel, contact.address) ? (
                <Link
                  to={composeEmailPath({ to: contact.address })}
                  className="text-xs font-medium text-accent hover:underline"
                >
                  {t('contactPanel.writeEmail')}
                </Link>
              ) : null}
              {!contactId ? (
                <Link
                  to="/contacts"
                  className="text-xs font-medium text-accent hover:underline"
                >
                  {t('contactPanel.openContacts')}
                </Link>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {previousThreads.slice(0, 8).map((thread) => (
              <Link
                key={String(thread.id)}
                to={inboxPath('open', String(thread.id))}
                className="flex items-center gap-2 rounded-md border border-transparent px-2.5 py-1.5 transition-colors hover:bg-bg-hover/70"
              >
                <ThreadStatusDot status={thread.status} unread={thread.hasUnread} title={threadStatusLabel(thread.status, t)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate-fade text-xs font-medium text-text-primary">
                    {thread.emailSubject || t('contactPanel.noSubject')}
                  </span>
                  <span className="block truncate-fade text-2xs text-text-muted">
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
