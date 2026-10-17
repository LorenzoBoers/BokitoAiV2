import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard'
import { toast } from 'sonner'
import {
  Check,
  Loader2,
  Mail,
  OctagonAlert,
  Phone,
  Plus,
  ShieldCheck,
  Users,
  UserRound,
} from 'lucide-react'
import { ChannelGlyph } from '../ui/ChannelGlyph'
import { ThreadStatusDot } from '../ui/ThreadStatusDot'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { ContactAvatar } from '../ui/ContactAvatar'
import { PersonAvatar } from '../ui/PersonAvatar'
import { Badge } from '../ui/badge'
import { MetaLine } from '../ui/meta-line'
import { SettingRow } from '../ui/entity-row'
import { SectionLabel } from '../ui/section-label'
import { controlTextClass } from '../ui/select'
import { useAuth } from '../../context/AuthContext'
import {
  findThreadsForContact,
  latestThreadActivityAt,
  linkConversationContact,
  normalizeContactBasis,
  resolveContact,
  setContactTags,
  updateContact,
  type ContactLinkCandidate,
  type ContactOwner,
  type ContactRow,
  type ContactStatus,
} from '../../lib/contacts-api'
import ContactOwnerPicker from './ContactOwnerPicker'
import { OwnerTagsField } from '../contacts/OwnerTagsField'
import {
  humanizeContactName,
  isAnonymousContact,
  isGenericVisitorName,
  isPlaceholderContactAddress,
} from '../../lib/contact-label'
import type {
  InboxMember,
  InboxThread,
  PatchThreadInput,
  RelatedConversation,
  ThreadId,
  ThreadStatus,
} from '../../lib/inbox-api'
import { inboxPath } from '../../lib/messages-paths'
import { IdentitySeenLine } from './IdentitySeenLine'
import { timeAgo } from '../../lib/time-ago'
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

/** Prefill the link form with the address already on the thread / contact. */
function suggestCaptureIdentifier(opts: {
  address?: string | null
  phone?: string | null
  fallbackEmail?: string | null
}): string {
  const address = (opts.address || '').trim()
  if (address && !isPlaceholderContactAddress(address)) return address
  const email = (opts.fallbackEmail || '').trim()
  if (email && !isPlaceholderContactAddress(email)) return email
  const phone = (opts.phone || '').trim()
  if (phone) return phone
  return ''
}

type Props = {
  contactId: string | null
  /** Fallback identity straight from the thread when no contact row exists. */
  fallbackName?: string
  fallbackEmail?: string
  currentThreadId?: ThreadId | null
  threadPreview?: string | null
  threadStatus?: ThreadStatus
  onPatch?: (input: PatchThreadInput) => Promise<void>
  /** How the current thread is linked: verified | claimed | manual; '' = inbound address. */
  contactBasis?: string
  /** Rendered above previous conversations (This conversation). */
  children?: ReactNode
  /** Close control on the identity row (no separate Who chrome). */
  closeAction?: ReactNode
  /** Activity on the open thread; fallback when the book has no last-seen. */
  threadActivityAt?: string | null
  /** Sibling conversations from the thread payload (other channels, merged identities). */
  relatedConversations?: RelatedConversation[]
}

type OtherConversation = {
  id: string
  channel: string
  subject: string
  status: ThreadStatus
  hasUnread: boolean
  lastMessageAt: string | null
  hasOpenProposal: boolean
}

const OPEN_STATUSES = new Set<string>(['open', 'pending'])

/**
 * Merge the contact book's threads with the sibling rows from the thread
 * payload, drop the current thread, and put open conversations first.
 */
export function otherConversations(
  threads: InboxThread[],
  related: RelatedConversation[] | undefined,
  currentThreadId: ThreadId | null | undefined,
): OtherConversation[] {
  const current = String(currentThreadId ?? '')
  const byId = new Map<string, OtherConversation>()
  for (const row of threads) {
    const id = String(row.id)
    if (id === current) continue
    byId.set(id, {
      id,
      channel: row.channel ?? '',
      subject: row.emailSubject || '',
      status: row.status,
      hasUnread: row.hasUnread,
      lastMessageAt: row.lastMessageAt ?? null,
      hasOpenProposal: false,
    })
  }
  for (const row of related ?? []) {
    if (row.id === current) continue
    const existing = byId.get(row.id)
    if (existing) {
      existing.hasOpenProposal = row.hasOpenProposal
      continue
    }
    byId.set(row.id, {
      id: row.id,
      channel: row.channel,
      subject: row.subject,
      status: row.status as ThreadStatus,
      hasUnread: false,
      lastMessageAt: row.lastMessageAt,
      hasOpenProposal: row.hasOpenProposal,
    })
  }
  const at = (row: OtherConversation) => (row.lastMessageAt ? new Date(row.lastMessageAt).getTime() : 0)
  return [...byId.values()].sort((a, b) => {
    const aOpen = OPEN_STATUSES.has(a.status) ? 0 : 1
    const bOpen = OPEN_STATUSES.has(b.status) ? 0 : 1
    if (aOpen !== bOpen) return aOpen - bOpen
    return at(b) - at(a)
  })
}

/** Header mark — same scale as AgentContextPanel. */
const CONTACT_MARK_SIZE = 36

function FieldRow({ icon: Icon, value }: { icon: typeof Mail; value?: string | null }) {
  if (!value) return null
  return (
    <p className="flex items-center gap-1.5 text-xs text-text-secondary">
      <Icon size={12} className="shrink-0 text-text-muted" />
      <span className="min-w-0 truncate-fade">{value}</span>
    </p>
  )
}

export default function ContactPanel({
  contactId,
  fallbackName,
  fallbackEmail,
  currentThreadId,
  threadPreview,
  threadStatus,
  onPatch,
  contactBasis,
  children,
  closeAction,
  threadActivityAt,
  relatedConversations,
}: Props) {
  const { t } = useTranslation('communication')
  const { token, user } = useAuth()
  const { members } = useMembers()
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
        setCaptureIdentifier(
          suggestCaptureIdentifier({
            address: row.address,
            phone: row.phone,
            fallbackEmail,
          }),
        )
      } else {
        setThreads([])
        setNotesDraft('')
        setCaptureName(fallbackName && !isGenericVisitorName(fallbackName) ? fallbackName : '')
        setCaptureIdentifier(suggestCaptureIdentifier({ fallbackEmail }))
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

  const setOwner = async (owner: ContactOwner | null) => {
    if (!token || !contact || saving) return
    const previous = contact.owner
    setContact((prev) => (prev ? { ...prev, owner } : prev))
    setSaving(true)
    try {
      const updated = await updateContact(token, contact.id, {
        owner: owner ? { kind: owner.kind, id: owner.id } : { kind: '', id: null },
      })
      if (updated) setContact((prev) => (prev ? { ...prev, owner: updated.owner } : updated))
    } catch (err) {
      setContact((prev) => (prev ? { ...prev, owner: previous } : prev))
      toast.error(formatApiErrorMessage(err, t('contactPanel.saveError')))
    } finally {
      setSaving(false)
    }
  }

  const canLink = Boolean(currentThreadId)
  const openCaptureForm = () => {
    setCaptureIdentifier((prev) =>
      prev.trim() ||
      suggestCaptureIdentifier({
        address: contact?.address,
        phone: contact?.phone,
        fallbackEmail,
      }),
    )
    if (!captureName.trim()) {
      const nameHint = contact?.displayName || fallbackName
      if (nameHint && !isGenericVisitorName(nameHint)) setCaptureName(nameHint)
    }
    setCaptureOpen(true)
  }
  const linkButton = canLink ? (
    <button
      type="button"
      onClick={openCaptureForm}
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
              <span className="mt-0.5 inline-flex items-center gap-1.5 rounded-lg bg-accent/12 px-2.5 py-0.5 text-xs font-medium text-accent">
                <Users size={11} />
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
            {onPatch ? (
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  void onPatch({ status: threadStatus === 'spam' ? 'open' : 'spam' })
                }
                className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover/60 disabled:opacity-50"
              >
                <OctagonAlert size={12} />
                {threadStatus === 'spam'
                  ? t('threadChrome.notSpam')
                  : t('threadChrome.markSpam')}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {children}
    </>
    )
  }

  const previousThreads = otherConversations(threads, relatedConversations, currentThreadId)

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
  const needsIdentity = isPlaceholderContactAddress(contact.address)
  const alsoSeenAsVisitor =
    namedHeadline &&
    (isPlaceholderContactAddress(contact.address) ||
      isGenericVisitorName(contact.displayName) ||
      (fallbackName != null && isGenericVisitorName(fallbackName)))

  const showEmail =
    !isPlaceholderContactAddress(contact.address) &&
    contact.address.trim().toLowerCase() !== String(headlineName).trim().toLowerCase()
  const hasFacts =
    showEmail || Boolean(contact.phone) || alsoSeenAsVisitor

  const kindLabel =
    contact.status === 'blocked'
      ? t('contactPanel.statusBlocked')
      : anonymous
        ? t('contactPanel.kindUnknownChatter')
        : t('contactPanel.kindContact')

  return (
    <div className="flex flex-col">
      <div className="border-b border-border/40 px-4 pb-3 pt-3">
        <div className="flex items-start gap-2.5">
          {namedHeadline ? (
            <Link
              to={`/contacts/${contact.id}`}
              className="shrink-0 rounded-full focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/50"
            >
              <ContactAvatar name={contact.displayName} email={contact.address} size={CONTACT_MARK_SIZE} />
            </Link>
          ) : (
            <ContactAvatar name={contact.displayName} email={contact.address} size={CONTACT_MARK_SIZE} />
          )}
          <div className="min-w-0 flex-1">
            {namedHeadline ? (
              <Link
                to={`/contacts/${contact.id}`}
                className="block truncate-fade text-sm font-semibold text-text-heading hover:text-accent"
              >
                {headlineName}
              </Link>
            ) : (
              <p className="truncate-fade text-sm font-semibold text-text-heading">{headlineName}</p>
            )}
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <MetaLine>
                <span className={contact.status === 'blocked' ? 'text-status-error' : undefined}>
                  {kindLabel}
                </span>
                {contact.company ? (
                  <Link
                    to={
                      contact.companyId
                        ? `/contacts/companies/${contact.companyId}`
                        : `/contacts?q=${encodeURIComponent(contact.company)}`
                    }
                    className="hover:text-accent"
                  >
                    {contact.company}
                  </Link>
                ) : null}
              </MetaLine>
              {basis === 'verified' || basis === 'claimed' ? (
                <Badge
                  data-testid="contact-basis"
                  size="sm"
                  variant={basis === 'verified' ? 'success' : 'neutral'}
                  icon={basis === 'verified' ? ShieldCheck : undefined}
                  title={t(
                    basis === 'verified'
                      ? 'contactPanel.basisVerifiedHint'
                      : 'contactPanel.basisClaimedHint',
                  )}
                >
                  {t(
                    basis === 'verified'
                      ? 'contactPanel.basisVerified'
                      : 'contactPanel.basisClaimed',
                  )}
                </Badge>
              ) : null}
            </div>
            {contact.title ? (
              <p className="mt-0.5 truncate-fade text-xs text-text-muted">{contact.title}</p>
            ) : null}
          </div>
          {closeAction}
        </div>

        {hasFacts ? (
          <div className="mt-2.5 space-y-1">
            {showEmail ? <FieldRow icon={Mail} value={contact.address} /> : null}
            {alsoSeenAsVisitor ? (
              <p className="flex items-center gap-1.5 text-xs text-text-muted">
                <ChannelGlyph channel={contact.channel || 'widget'} size={12} className="shrink-0" />
                <span className="min-w-0 truncate-fade">
                  {t('contactPanel.alsoSeenAs', { label: t('contactPanel.widgetVisitor') })}
                </span>
              </p>
            ) : null}
            <FieldRow icon={Phone} value={contact.phone} />
          </div>
        ) : null}

        <div className="mt-3 divide-y divide-border/40">
          <AiHandlingPicker
            variant="row"
            scope="contact"
            handling={aiHandling.handling}
            canRaise={aiHandling.canRaise}
            saving={aiHandling.saving}
            onChange={(mode) => void aiHandling.change(mode)}
            label={t('aiHandling.title', { ns: 'common' })}
            testId="contact-ai-handling"
            triggerAppearance="text"
            className="py-1.5"
          />
          {!anonymous && contact.owner ? (
            <SettingRow label={t('contactPanel.owner')} className="py-1.5">
              <ContactOwnerPicker
                variant="chip"
                owner={contact.owner}
                onChange={(owner) => void setOwner(owner)}
                disabled={saving}
                triggerClassName={controlTextClass}
              />
            </SettingRow>
          ) : null}
          {!anonymous && ((contact.tags?.length ?? 0) > 0 || (contact.companyTags?.length ?? 0) > 0) ? (
            <div data-testid="contact-panel-tags">
              <SettingRow label={t('contactPanel.tags')} className="py-1.5">
                <OwnerTagsField
                  tags={contact.tags ?? []}
                  inherited={contact.companyTags ?? []}
                  inheritedLabel={t('contactPanel.viaCompany')}
                  disabled={saving}
                  compact
                  onChange={(names) => {
                    void (async () => {
                      if (!token) return
                      setSaving(true)
                      try {
                        const tags = await setContactTags(token, contact.id, names)
                        setContact((prev) => (prev ? { ...prev, tags } : prev))
                      } catch (err) {
                        toast.error(formatApiErrorMessage(err, t('contactPanel.saveError')))
                      } finally {
                        setSaving(false)
                      }
                    })()
                  }}
                />
              </SettingRow>
            </div>
          ) : null}
        </div>

        {notesDraft.trim() || notesDirty ? (
          <div className="mt-2.5">
            <textarea
              value={notesDraft}
              onChange={(e) => {
                setNotesDraft(e.target.value)
                setNotesDirty(true)
              }}
              rows={1}
              placeholder={t('contactPanel.notesPlaceholder')}
              aria-label={t('contactPanel.notes')}
              className="min-h-7 w-full resize-y rounded-md border border-transparent bg-transparent px-0 py-0.5 text-xs text-text-secondary placeholder:text-text-muted transition-colors focus:border-border/60 focus:bg-bg-input focus:px-2 focus:py-1.5 focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
            {notesDirty ? (
              <div className="mt-1 flex items-center gap-2 px-0.5">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveNotes()}
                  className="flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-2xs font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
                >
                  <Check size={10} />
                  {saving ? t('contactPanel.saving') : t('contactPanel.saveNotes')}
                </button>
                <span className="text-2xs text-status-warning">{t('contactPanel.notesUnsaved')}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        {needsIdentity ? linkForm : null}
        {(needsIdentity && !captureOpen) || (statusPending && !anonymous) ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {needsIdentity && !captureOpen ? linkButton : null}
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
          </div>
        ) : null}
      </div>

      {children}

      <div className="border-b border-border/40 px-4 py-3">
        <SectionLabel title={t('contactPanel.previous')} headerClassName="-mx-1 mb-1" />
        {previousThreads.length === 0 ? (
          <p className="text-xs text-text-muted">{t('contactPanel.noPrevious')}</p>
        ) : (
          <div className="space-y-1">
            {previousThreads.slice(0, 5).map((thread) => (
              <Link
                key={thread.id}
                to={inboxPath('open', thread.id)}
                className="flex items-center gap-2 rounded-md border border-transparent px-2.5 py-1.5 transition-colors hover:bg-bg-hover/70"
                data-testid="contact-other-conversation"
              >
                <ThreadStatusDot status={thread.status} unread={thread.hasUnread} title={threadStatusLabel(thread.status, t)} />
                <ChannelGlyph channel={thread.channel} size={13} className="shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate-fade text-xs font-medium text-text-primary">
                    {thread.subject || t('contactPanel.noSubject')}
                  </span>
                  <span className="block truncate-fade text-2xs text-text-muted">
                    {threadStatusLabel(thread.status, t)}
                    {thread.lastMessageAt ? ` - ${timeAgo(thread.lastMessageAt, t)}` : ''}
                    {thread.hasOpenProposal ? ` - ${t('contactPanel.openProposalShort')}` : ''}
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
