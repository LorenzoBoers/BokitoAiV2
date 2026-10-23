import { Card } from '../ui/card'
import { useCallback, useEffect, useState } from 'react'
import { timeAgo } from '../../lib/time-ago'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { toastMovedToBin } from '../../lib/bin-toast'
import { ENTITY_ICONS } from '../../lib/entity-icons'
import { openEntityPath } from '../../lib/open-entity'
import { Check, Mail, ShieldBan, ShieldCheck, Trash2 } from 'lucide-react'

const Building2 = ENTITY_ICONS.company
const MessageSquare = ENTITY_ICONS.conversation
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { ProfileSkeleton } from '../ui/skeleton'
import { ChannelGlyph, ChannelLabel, channelKind } from '../ui/ChannelGlyph'
import { ThreadStatusDot } from '../ui/ThreadStatusDot'
import { PersonAvatar } from '../ui/PersonAvatar'
import { Badge } from '../ui/badge'
import { useConfirm } from '../ui/confirm-dialog'
import { useAuth } from '../../context/AuthContext'
import { PageHeader } from '../ui/page-header'
import { PageContent } from '../layout/PageContent'
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard'
import { deleteContact, detachContactIdentity, findThreadsForContact, getContact, getContactThreadPage, setContactTags, updateContact, type ContactOwner, type ContactRow, type ContactStatus } from '../../lib/contacts-api'
import ContactOwnerPicker from '../inbox/ContactOwnerPicker'
import { contactStatusLabel, threadStatusLabel } from '../../lib/status-labels'
import { isAnonymousContact, isPlaceholderContactAddress } from '../../lib/contact-label'

import { inboxPath } from '../../lib/messages-paths'
import { canComposeToAddress, composeEmailPath } from '../../lib/compose-intent'
import { useMailboxConnections } from '../../hooks/useMailboxConnections'
import type { InboxThread } from '../../lib/inbox-api'
import { ContactFolderChips, ThreadLookAt, ThreadTicketPrefix } from './ContactThreadMeta'
import { OwnerTagsField } from './OwnerTagsField'
import { TextLink } from '../ui/text-link'
import { STATUS_TONE, displayContactStatus } from './contact-status'
import { Input } from '../ui/input'

export function ContactDetail({ contactId }: { contactId: string }) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const { activeConnections } = useMailboxConnections()
  const mailboxReady = activeConnections.length > 0
  const navigate = useNavigate()
  const [contact, setContact] = useState<ContactRow | null>(null)
  const [threads, setThreads] = useState<InboxThread[]>([])
  const [threadTotal, setThreadTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState({ displayName: '', company: '', title: '', phone: '', notes: '' })
  const [dirty, setDirty] = useState(false)
  const { t: tc } = useTranslation('common')
  const confirm = useConfirm()

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const row = await getContact(token, contactId)
      setContact(row)
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
      if (!row) {
        setThreads([])
        setThreadTotal(0)
      } else {
        try {
          const page = await getContactThreadPage(token, row.id)
          if (page.threads.length > 0 || page.total > 0) {
            setThreads(page.threads)
            setThreadTotal(page.total)
          } else {
            const history = await findThreadsForContact(token, row)
            setThreads(history)
            setThreadTotal(Math.max(history.length, row.threadCount))
          }
        } catch {
          try {
            const history = await findThreadsForContact(token, row)
            setThreads(history)
            setThreadTotal(Math.max(history.length, row.threadCount))
          } catch {
            setThreads([])
            setThreadTotal(row.threadCount)
          }
        }
      }
    } catch (err) {
      setContact(null)
      setThreads([])
      setThreadTotal(0)
      toast.error(formatApiErrorMessage(err, t('contactsPage.loadContactError')))
    } finally {
      setLoading(false)
    }
  }, [token, contactId, t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (loading || typeof window === 'undefined') return
    if (window.location.hash !== '#conversations') return
    const el = document.getElementById('conversations')
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [loading, threads.length])

  useUnsavedChangesGuard(dirty, t('contactsPage.unsavedLeave'))

  const detachIdentity = async (identityId: string) => {
    if (!token || !contact || saving) return
    if (!(await confirm({ description: t('contactsPage.detachConfirm'), confirmLabel: t('actions.detach', { ns: 'common' }), destructive: true }))) return
    setSaving(true)
    try {
      await detachContactIdentity(token, contact.id, identityId)
      toast.success(t('contactsPage.detached'))
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('contactsPage.detachError')))
    } finally {
      setSaving(false)
    }
  }

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
      toast.success(t('contactsPage.savedContact'))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('contactsPage.saveContactError')))
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
      toast.success(t('contactsPage.ownerSaved'))
    } catch (err) {
      setContact((prev) => (prev ? { ...prev, owner: previous } : prev))
      toast.error(formatApiErrorMessage(err, t('contactsPage.saveContactError')))
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
      toast.success(
        status === 'blocked'
          ? t('contactsPage.blocked')
          : status === 'approved'
            ? t('contactsPage.approved')
            : t('contactsPage.statusUpdated'),
      )
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('contactsPage.statusError')))
    } finally {
      setSaving(false)
    }
  }

  const removeContact = async () => {
    if (!token || !contact || saving) return
    const label = contact.displayName || contact.address || t('contactsPage.thisContact')
    if (!(await confirm({ description: t('contactsPage.deleteContactConfirm', { label }), destructive: true }))) return
    setSaving(true)
    try {
      await deleteContact(token, contact.id)
      toastMovedToBin(t('contactsPage.deletedContact'), navigate)
      navigate('/contacts')
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('contactsPage.deleteContactError')))
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <PageContent width="xl">
        <ProfileSkeleton />
      </PageContent>
    )
  }

  if (!contact) {
    return (
      <div className="pt-10 text-center">
        <p className="text-sm text-text-muted">{t('contactsPage.contactNotFound')}</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
          <TextLink
            type="button"
            onClick={() => void load()}
            className="text-sm"
          >
            {t('contactsPage.tryAgain')}
          </TextLink>
          <TextLink
            type="button"
            onClick={() => navigate('/contacts')}
            className="text-sm"
          >
            {t('contactsPage.backToContacts')}
          </TextLink>
        </div>
      </div>
    )
  }

  const field = (label: string, key: keyof typeof draft, placeholder: string) => (
    <label className="block">
      <span className="text-xs font-semibold text-text-muted">{label}</span>
      <Input
        value={draft[key]}
        onChange={(e) => {
          setDraft((prev) => ({ ...prev, [key]: e.target.value }))
          setDirty(true)
        }}
        placeholder={placeholder}
        className="h-8 mt-1 w-full"
      />
    </label>
  )

  return (
    <PageContent width="xl">
      <PageHeader
        title={contact.displayName || contact.address || t('contactsPage.newContact')}
        subtitle={
          contact.title || contact.company ? (
            <>
              {contact.title}
              {contact.title && contact.company ? ' - ' : null}
              {contact.company ? (
                contact.companyId ? (
                  <Link
                    to={openEntityPath({ type: 'company', id: contact.companyId })}
                    className="hover:text-accent hover:underline"
                    title={t('contactsPage.openCompany', { name: contact.company })}
                    data-testid="contact-company-link"
                  >
                    {contact.company}
                  </Link>
                ) : (
                  contact.company
                )
              ) : null}
            </>
          ) : (
            t(`contactsPage.channels.${channelKind(contact.channel)}`, { defaultValue: contact.channel })
          )
        }
        back={{ to: '/contacts', label: t('contactsPage.allContacts') }}
        primaryAction={
          mailboxReady && canComposeToAddress(contact.channel, contact.address) ? (
            <Link
              to={composeEmailPath({ to: contact.address })}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover"
              title={t('contactsPage.writeEmailHint')}
            >
              <Mail size={14} />
              {t('contactsPage.writeEmail')}
            </Link>
          ) : undefined
        }
        actions={
          <>
            {threads[0] ? (
              <Link
                to={inboxPath('open', String(threads[0].id))}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  canComposeToAddress(contact.channel, contact.address)
                    ? 'border border-border text-text-secondary hover:bg-bg-hover'
                    : 'bg-accent text-accent-fg hover:bg-accent-hover'
                }`}
                title={t('contactsPage.openConversationHint')}
              >
                <MessageSquare size={12} />
                {t('contactsPage.openConversation')}
              </Link>
            ) : null}
            {contact.status !== 'approved' ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void setStatus('approved')}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-status-success disabled:opacity-50"
              >
                <ShieldCheck size={14} />
                {t('contactsPage.approve')}
              </button>
            ) : null}
            {contact.status !== 'blocked' ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void setStatus('blocked')}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-status-error disabled:opacity-50"
              >
                <ShieldBan size={14} />
                {t('contactsPage.block')}
              </button>
            ) : null}
            <button
              type="button"
              disabled={saving}
              onClick={() => void removeContact()}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-status-error/50 hover:text-status-error disabled:opacity-50"
            >
              <Trash2 size={14} />
              {t('contactsPage.delete')}
            </button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card asChild padding="default">
          <section>
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2.5">
                <PersonAvatar name={contact.displayName} email={contact.address} size={32} />
                <h2 className="truncate-fade text-base font-semibold text-text-heading">{t('contactsPage.profile')}</h2>
              </span>
              <Badge size="sm" variant={STATUS_TONE[displayContactStatus(contact)]}>
                {isAnonymousContact(contact.displayName, contact.address)
                  ? t('contactsPage.statusAwaitingEmail')
                  : contactStatusLabel(contact.status, t)}
              </Badge>
            </div>
            <div className="mt-3 space-y-3">
              <p className="flex items-center gap-2 text-sm text-text-secondary">
                <ChannelGlyph channel={contact.channel} size={13} />
                {isPlaceholderContactAddress(contact.address)
                  ? t('contactsPage.alsoSeenAsVisitor')
                  : contact.address || t('contactsPage.noAddress')}
                <span className="ml-auto text-xs text-text-muted">
                  <ChannelLabel
                    channel={contact.channel}
                    label={t(`contactsPage.channels.${channelKind(contact.channel)}`, { defaultValue: contact.channel })}
                    size={11}
                  />
                </span>
              </p>
              {contact.identities.length > 0 ? (
                <div data-testid="contact-identities">
                  <span className="text-xs font-semibold text-text-muted">{t('contactsPage.identities')}</span>
                  <ul className="mt-1 space-y-1">
                    {contact.identities.map((identity) => (
                      <li key={identity.id} className="flex items-center gap-2 text-sm text-text-secondary">
                        <ChannelGlyph channel={identity.channel} size={13} className="shrink-0" />
                        <span className="min-w-0 truncate-fade">
                          {isPlaceholderContactAddress(identity.address)
                            ? t('contactsPage.widgetVisitor')
                            : identity.address}
                        </span>
                        <span className="ml-auto shrink-0 text-xs text-text-muted">
                          {identity.lastSeenAt ? timeAgo(identity.lastSeenAt, t) : ''}
                        </span>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void detachIdentity(identity.id)}
                          title={t('contactsPage.detachHint')}
                          className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
                        >
                          {t('contactsPage.detach')}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="rounded-md border border-border px-3 py-2.5" data-testid="contact-tags">
                <p className="mb-1.5 text-xs font-semibold text-text-muted">{t('contactsPage.tags', { defaultValue: 'Tags' })}</p>
                <OwnerTagsField
                  tags={contact.tags ?? []}
                  inherited={contact.companyTags ?? []}
                  inheritedLabel={t('contactsPage.viaCompany', { defaultValue: 'via company' })}
                  disabled={saving}
                  onChange={(names) => {
                    void (async () => {
                      if (!token) return
                      setSaving(true)
                      try {
                        const tags = await setContactTags(token, contact.id, names)
                        setContact((current) => (current ? { ...current, tags } : current))
                      } catch (err) {
                        toast.error(formatApiErrorMessage(err, t('contactsPage.saveError')))
                      } finally {
                        setSaving(false)
                      }
                    })()
                  }}
                />
              </div>
              <div className="rounded-md border border-border px-3 py-2.5" data-testid="contact-owner">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-text-muted">{t('contactsPage.owner')}</span>
                  <div className="w-[220px]">
                    <ContactOwnerPicker
                      owner={contact.owner}
                      onChange={(owner) => void setOwner(owner)}
                      disabled={saving}
                    />
                  </div>
                </div>
              </div>
              {field(t('contactsPage.fieldName'), 'displayName', t('contactsPage.namePlaceholderFull'))}
              <div className="grid grid-cols-2 gap-3">
                {field(t('contactsPage.fieldCompany'), 'company', t('contactsPage.fieldCompany'))}
                {field(t('contactsPage.fieldTitle'), 'title', t('contactsPage.titlePlaceholder'))}
              </div>
              {contact.companyId ? (
                <Link
                  to={`/contacts/companies/${contact.companyId}`}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
                >
                  <Building2 size={12} />
                  {t('contactsPage.viewCompany')}
                </Link>
              ) : (
                <div className="space-y-1">
                  <p className="text-xs text-text-muted">{t('contactsPage.noCompanyHint')}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <Link
                      to="/contacts?view=companies"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
                    >
                      <Building2 size={12} />
                      {t('contactsPage.viewCompanies')}
                    </Link>
                    <span className="text-xs text-text-muted">{t('contactsPage.linkContactsHint')}</span>
                  </div>
                </div>
              )}
              {field(t('contactsPage.fieldPhone'), 'phone', t('contactsPage.phonePlaceholder'))}
              <label className="block">
                <span className="text-xs font-semibold text-text-muted">{t('contactsPage.notes')}</span>
                <textarea
                  value={draft.notes}
                  onChange={(e) => {
                    setDraft((prev) => ({ ...prev, notes: e.target.value }))
                    setDirty(true)
                  }}
                  rows={4}
                  placeholder={t('contactsPage.notesPlaceholder')}
                  className="mt-1 w-full resize-none rounded-md border border-border bg-bg-surface px-2.5 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
                />
              </label>
              {dirty ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save()}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
                >
                  <Check size={14} />
                  {saving ? t('contactsPage.saving') : t('contactsPage.saveChanges')}
                </button>
              ) : null}
            </div>
          </section>
        </Card>

        <Card asChild padding="default">
          <section id="conversations">
            <h2 className="text-base font-semibold text-text-heading">{t('contactsPage.conversations')}</h2>
            <p className="text-xs text-text-muted">
              {threadTotal > threads.length
                ? t('contactsPage.threadCountPartial', { shown: threads.length, count: threadTotal })
                : t('contactsPage.threadCount', { count: threadTotal })}
            </p>
            <div className="mt-2">
              <ContactFolderChips threads={threads} />
            </div>
            <div className="mt-3 space-y-1.5">
              {threads.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-3 py-5 text-center">
                  <p className="text-xs text-text-muted">{t('contactsPage.noConversations')}</p>
                  <p className="mt-1 text-xs text-text-muted">{t('contactsPage.noConversationsHint')}</p>
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                    {mailboxReady && canComposeToAddress(contact.channel, contact.address) ? (
                      <Link
                        to={composeEmailPath({ to: contact.address })}
                        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
                      >
                        {t('contactsPage.writeEmail')}
                      </Link>
                    ) : (
                      <Link
                        to="/settings/channels"
                        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
                      >
                        {t('contactsPage.connectChannels')}
                      </Link>
                    )}
                    <Link
                      to={inboxPath('open')}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover"
                    >
                      {t('contactsPage.openCommunication')}
                    </Link>
                  </div>
                </div>
              ) : (
                threads.map((thread) => (
                  <Link
                    key={String(thread.id)}
                    to={inboxPath('open', String(thread.id))}
                    className="group flex items-center gap-2.5 rounded-md border border-transparent px-3 py-2 transition-colors hover:bg-bg-hover"
                  >
                    <ThreadStatusDot status={thread.status} unread={thread.hasUnread} title={threadStatusLabel(thread.status, t)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate-fade text-sm font-medium text-text-primary">
                        {thread.emailSubject || t('contactsPage.noSubject')}
                      </span>
                      <span className="block truncate-fade text-xs text-text-muted">
                        <ThreadTicketPrefix thread={thread} />
                        {threadStatusLabel(thread.status, t)}
                        {thread.lastMessageAt ? ` - ${timeAgo(thread.lastMessageAt, t)}` : ''}
                      </span>
                    </span>
                    <ThreadLookAt thread={thread} />
                  </Link>
                ))
              )}
            </div>
          </section>
        </Card>
      </div>
    </PageContent>
  )
}
