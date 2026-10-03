import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard'
import { toast } from 'sonner'
import {
  Building2,
  Check,
  Loader2,
  Mail,
  Phone,
  Plus,
  ShieldBan,
  ShieldCheck,
  Unlink,
  Users,
  UserRound,
} from 'lucide-react'
import { ChannelGlyph } from '../ui/ChannelGlyph'
import { ThreadStatusDot } from '../ui/ThreadStatusDot'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { PersonAvatar } from '../ui/PersonAvatar'
import { useAuth } from '../../context/AuthContext'
import {
  findThreadsForContact,
  latestThreadActivityAt,
  linkConversationContact,
  normalizeContactBasis,
  resolveContact,
  unlinkConversationContact,
  updateContact,
  type ContactLinkCandidate,
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
import { IdentitySeenLine, timeAgo } from './IdentitySeenLine'
import { useMailboxConnections } from '../../hooks/useMailboxConnections'
import { useMembers } from '../../hooks/useMembers'
import { useAiHandling } from '../../hooks/useAiHandling'
import AiHandlingPicker from '../ai/AiHandlingPicker'
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
  /** How the current thread is linked: verified | claimed | manual; '' = inbound address. */
  contactBasis?: string
  /** Rendered above previous conversations (This conversation). */
  children?: ReactNode
  /** Close control on the identity row (no separate Who chrome). */
  closeAction?: ReactNode
  /** Activity on the open thread; fallback when the book has no last-seen. */
  threadActivityAt?: string | null
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
  contactBasis,
  children,
  closeAction,
  threadActivityAt,
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
  const [captureIdentifier, setCaptureIdentifier] = useState('')
  const [captureOpen, setCaptureOpen] = useState(false)
  const [candidates, setCandidates] = useState<ContactLinkCandidate[]>([])
  // The thread prop catches up through the realtime thread update; until
  // then the panel follows the link result.
  const [linked, setLinked] = useState<{ contactId: string | null; basis: string } | null>(null)
  const { t: tc } = useTranslation('common')
  const aiHandling = useAiHandling('contact', contact?.id ?? null)
  const effectiveContactId = linked ? linked.contactId : contactId
  const basis = normalizeContactBasis(linked ? linked.basis : contactBasis)

  useEffect(() => {
    setLinked(null)
    setCandidates([])
    setCaptureOpen(false)
  }, [currentThreadId, contactId, contactBasis])

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
        id: effectiveContactId,
        email: linked ? null : fallbackEmail,
        name: linked ? null : fallbackName,
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
        setCaptureIdentifier('')
      } else {
        setThreads([])
        setNotesDraft('')
        setCaptureName(fallbackName && !isGenericVisitorName(fallbackName) ? fallbackName : '')
        setCaptureIdentifier('')
      }
      setNotesDirty(false)
    } catch (err) {
      setContact(null)
      setThreads([])
      toast.error(formatApiErrorMessage(err, t('contactPanel.loadError')))
    } finally {
      setLoading(false)
    }
  }, [token, effectiveContactId, linked, fallbackEmail, fallbackName, t])

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

  const linkContact = async (pickedId?: string) => {
    if (!token || !currentThreadId || saving) return
    const identifier = captureIdentifier.trim()
    if (!pickedId && !identifier) {
      toast.error(t('contactPanel.identifierRequired'))
      return
    }
    setSaving(true)
    try {
      const isEmail = identifier.includes('@')
      const result = await linkConversationContact(token, String(currentThreadId), {
        contactId: pickedId,
        email: !pickedId && isEmail ? identifier : undefined,
        phone: !pickedId && !isEmail ? identifier : undefined,
        name: captureName.trim() || undefined,
      })
      if (result.status === 'choose') {
        setCandidates(result.candidates)
        return
      }
      setCandidates([])
      setCaptureOpen(false)
      setLinked({ contactId: result.contactId, basis: result.basis })
      const name = result.contactName || identifier
      if (result.status === 'created') toast.success(t('contactPanel.linkCreated', { name }))
      else if (result.status === 'unchanged') toast.message(t('contactPanel.linkUnchanged'))
      else toast.success(t('contactPanel.linked', { name }))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('contactPanel.linkError')))
    } finally {
      setSaving(false)
    }
  }

  const unlinkContact = async () => {
    if (!token || !currentThreadId || saving) return
    if (!window.confirm(t('contactPanel.unlinkConfirm'))) return
    setSaving(true)
    try {
      await unlinkConversationContact(token, String(currentThreadId))
      // The previous identity comes back with the realtime thread update.
      setLinked(null)
      toast.success(t('contactPanel.unlinked'))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('contactPanel.unlinkError')))
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

  const canLink = Boolean(currentThreadId)
  const linkButton = canLink ? (
    <button
      type="button"
      onClick={() => setCaptureOpen(true)}
      title={t('contactPanel.linkHint')}
      data-testid="contact-link-open"
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border/60 px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
    >
      <Plus size={11} />
      {t('contactPanel.link')}
    </button>
  ) : null
  const inputClass =
    'w-full rounded-md border border-border/60 bg-bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50'
  const linkForm =
    canLink && captureOpen ? (
      <form
        className="mt-3 space-y-1.5 text-left"
        data-testid="contact-link-form"
        onSubmit={(e) => {
          e.preventDefault()
          void linkContact()
        }}
      >
        <input
          type="text"
          value={captureIdentifier}
          onChange={(e) => {
            setCaptureIdentifier(e.target.value)
            setCandidates([])
          }}
          placeholder={t('contactPanel.identifierPlaceholder')}
          autoFocus
          className={inputClass}
        />
        <input
          type="text"
          value={captureName}
          onChange={(e) => setCaptureName(e.target.value)}
          placeholder={t('contactPanel.namePlaceholder')}
          className={inputClass}
        />
        {candidates.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs text-text-muted">{t('contactPanel.linkChoose')}</p>
            {candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                disabled={saving}
                onClick={() => void linkContact(candidate.id)}
                className="flex w-full items-center gap-2 rounded-md border border-border/60 px-2 py-1 text-left text-xs hover:bg-bg-hover/60 disabled:opacity-50"
              >
                <span className="min-w-0 flex-1 truncate-fade font-medium text-text-primary">
                  {candidate.displayName || candidate.address}
                </span>
                <span className="min-w-0 truncate-fade text-text-muted">{candidate.address}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-1.5">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? t('contactPanel.saving') : t('contactPanel.linkSubmit')}
          </button>
          <button
            type="button"
            onClick={() => {
              setCaptureOpen(false)
              setCandidates([])
            }}
            className="rounded-md px-2 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover/60"
          >
            {t('contactPanel.cancel')}
          </button>
        </div>
      </form>
    ) : null

  if (loading) {
    return (
      <>
        <div className="flex items-center gap-2 px-4 py-4 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="min-w-0 flex-1">{t('contactPanel.loading')}</span>
          {closeAction}
        </div>
        {children}
      </>
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
      <>
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
              <IdentitySeenLine at={latestThreadActivityAt(threads) || threadActivityAt} />
              <p className="mt-1 truncate-fade text-xs text-text-muted">
                {roleLabel(teammate.role, t)}
              </p>
            </div>
            {closeAction}
          </div>
          <div className="mt-3 space-y-1.5">
            <FieldRow icon={Mail} value={teammate.email} />
          </div>
          <p className="mt-2 text-xs text-text-muted">{t('contactPanel.teammateHint')}</p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Link
              to="/team"
              className="inline-flex shrink-0 items-center whitespace-nowrap rounded-md border border-border/60 px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover/60"
            >
              {t('contactPanel.openMembers')}
            </Link>
          </div>
        </div>
      </div>
      {children}
    </>
    )
  }

  if (!contact) {
    const readableEmail =
      fallbackEmail && !isPlaceholderContactAddress(fallbackEmail) ? fallbackEmail : ''
    return (
      <>
      <div className="px-4 py-4">
        {closeAction ? <div className="mb-1 flex justify-end">{closeAction}</div> : null}
        <div className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center">
          <UserRound size={18} className="mx-auto text-text-muted" />
          <p className="mt-2 text-sm font-medium text-text-primary">
            {humanizeContactName(fallbackName, fallbackEmail, t('contactPanel.widgetVisitor')) ||
              t('contactPanel.noContact')}
          </p>
          <IdentitySeenLine at={threadActivityAt} />
          {readableEmail ? <p className="text-xs text-text-muted">{readableEmail}</p> : null}
          <p className="mt-2 text-xs text-text-muted">
            {t('contactPanel.noContactHint')}
          </p>
          {linkForm}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {!captureOpen ? linkButton : null}
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
      {children}
    </>
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
  const lastSeenAt = contact.lastSeenAt || latestThreadActivityAt(threads)
  const needsIdentity = isPlaceholderContactAddress(contact.address)
  const alsoSeenAsVisitor =
    namedHeadline &&
    (isPlaceholderContactAddress(contact.address) ||
      isGenericVisitorName(contact.displayName) ||
      (fallbackName != null && isGenericVisitorName(fallbackName)))

  return (
    <div className="flex flex-col">
      <div className="border-b border-border/40 px-4 pb-3 pt-3">
        <div className="flex items-start gap-2.5">
          <PersonAvatar name={contact.displayName} email={contact.address} size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate-fade text-base font-semibold text-text-heading">{headlineName}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span
              className={`text-2xs font-semibold ${
                contact.status === 'blocked'
                  ? 'text-status-error'
                  : 'text-text-muted'
              }`}
            >
              {contact.status === 'blocked'
                ? t('contactPanel.statusBlocked')
                : anonymous
                  ? t('contactPanel.kindUnknownChatter')
                  : t('contactPanel.kindContact')}
            </span>
            {basis === 'verified' || basis === 'claimed' ? (
              <span
                data-testid="contact-basis"
                title={t(basis === 'verified' ? 'contactPanel.basisVerifiedHint' : 'contactPanel.basisClaimedHint')}
                className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-2xs font-semibold ${
                  basis === 'verified'
                    ? 'bg-status-success/12 text-status-success'
                    : 'bg-bg-hover text-text-secondary'
                }`}
              >
                {basis === 'verified' ? <ShieldCheck size={9} /> : null}
                {t(basis === 'verified' ? 'contactPanel.basisVerified' : 'contactPanel.basisClaimed')}
              </span>
            ) : null}
            </div>
            <IdentitySeenLine at={lastSeenAt || threadActivityAt} />
            {contact.title || contact.company ? (
              <p className="truncate-fade text-xs text-text-muted">
                {[contact.title, contact.company].filter(Boolean).join(' - ')}
              </p>
            ) : null}
          </div>
          {closeAction}
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
        {needsIdentity ? linkForm : null}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {needsIdentity && !captureOpen ? linkButton : null}
          {basis && currentThreadId ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void unlinkContact()}
              data-testid="contact-unlink"
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border/60 px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary disabled:opacity-50"
            >
              <Unlink size={11} />
              {t('contactPanel.unlink')}
            </button>
          ) : null}
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
          {!namedHeadline ? null : (
            <Link
              to={`/contacts/${contact.id}`}
              className="ml-auto inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-medium text-accent hover:underline"
            >
              {t('contactPanel.fullProfile')}
            </Link>
          )}
        </div>
      </div>

      <div className="border-b border-border/40 px-4 py-2">
        <AiHandlingPicker
          variant="row"
          scope="contact"
          handling={aiHandling.handling}
          canRaise={aiHandling.canRaise}
          saving={aiHandling.saving}
          onChange={(mode) => void aiHandling.change(mode)}
          label={tc('aiHandling.title')}
          testId="contact-ai-handling"
        />
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

      {children}

      {/* Previous conversations (Who — history with this person) */}
      <div className="border-b border-border/40 px-4 py-3">
        <h3 className="mb-2 text-xs font-semibold text-text-muted">
          {t('contactPanel.previous')}
        </h3>
        {previousThreads.length === 0 ? (
          <p className="text-xs text-text-muted">{t('contactPanel.noPrevious')}</p>
        ) : (
          <div className="space-y-1">
            {previousThreads.slice(0, 5).map((thread) => (
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
            {previousThreads.length > 5 && contactId && namedHeadline ? (
              <Link
                to={`/contacts/${contactId}#conversations`}
                className="mt-1 block px-2.5 py-1 text-xs font-medium text-accent hover:underline"
              >
                {t('contactPanel.showMore')}
              </Link>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
