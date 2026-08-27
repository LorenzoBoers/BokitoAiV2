import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
import { TableRowsSkeleton } from '../components/ui/skeleton'
import { ChannelGlyph, ChannelLabel, channelKind } from '../components/ui/ChannelGlyph'
import { DomainFavicon } from '../components/ui/DomainFavicon'
import { useAuth } from '../context/AuthContext'
import ContentHeader from '../components/shell/ContentHeader'
import { PageContent } from '../components/layout/PageContent'
import { PageGuideBanner } from '../components/layout/PageGuideBanner'
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard'
import {
  backfillCompanies,
  createContact,
  deleteCompany,
  deleteContact,
  getCompany,
  enrichContactsFromThreads,
  findThreadsForContact,
  getContact,
  latestThreadActivityAt,
  listCompanies,
  listContacts,
  updateCompany,
  updateContact,
  type CompanyDetail as CompanyDetailData,
  type CompanyRow,
  type ContactRow,
  type ContactStatus,
} from '../lib/contacts-api'
import { contactStatusLabel, threadStatusLabel } from '../lib/status-labels'
import { humanizeContactName, isPlaceholderContactAddress } from '../lib/contact-label'
import { inboxPath } from '../lib/messages-paths'
import { canComposeToAddress, composeEmailPath } from '../lib/compose-intent'
import type { InboxThread } from '../lib/inbox-api'
import { listSignalThreads } from '../lib/signals-api'

const STATUS_STYLE: Record<ContactStatus, string> = {
  approved: 'bg-status-success/15 text-status-success',
  pending: 'bg-status-warning/15 text-status-warning',
  blocked: 'bg-status-error/15 text-status-error',
}

function timeAgo(iso: string | null, t: (key: string, opts?: { count: number }) => string): string {
  if (!iso) return '-'
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return t('contactsPage.now')
  if (minutes < 60) return t('contactsPage.minutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('contactsPage.hoursAgo', { count: hours })
  return t('contactsPage.daysAgo', { count: Math.floor(hours / 24) })
}

function ContactDetail({ contactId }: { contactId: string }) {
  const { t } = useTranslation('nav')
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
      } else {
        try {
          setThreads(await findThreadsForContact(token, row))
        } catch {
          setThreads([])
        }
      }
    } catch (err) {
      setContact(null)
      setThreads([])
      toast.error(formatApiErrorMessage(err, t('contactsPage.loadContactError')))
    } finally {
      setLoading(false)
    }
  }, [token, contactId, t])

  useEffect(() => {
    void load()
  }, [load])

  useUnsavedChangesGuard(dirty, t('contactsPage.unsavedLeave'))

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
    if (!window.confirm(t('contactsPage.deleteContactConfirm', { label }))) return
    setSaving(true)
    try {
      await deleteContact(token, contact.id)
      toast.success(t('contactsPage.deletedContact'))
      navigate('/contacts')
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('contactsPage.deleteContactError')))
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <PageContent width="xl">
        <TableRowsSkeleton rows={5} className="pt-4" />
      </PageContent>
    )
  }

  if (!contact) {
    return (
      <div className="pt-10 text-center">
        <p className="text-sm text-text-muted">{t('contactsPage.contactNotFound')}</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => void load()}
            className="text-sm font-medium text-accent hover:underline"
          >
            {t('contactsPage.tryAgain')}
          </button>
          <button
            type="button"
            onClick={() => navigate('/contacts')}
            className="text-sm font-medium text-accent hover:underline"
          >
            {t('contactsPage.backToContacts')}
          </button>
        </div>
      </div>
    )
  }

  const lastSeenAt = contact.lastSeenAt || latestThreadActivityAt(threads)

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
        title={contact.displayName || contact.address || t('contactsPage.newContact')}
        subtitle={[contact.title, contact.company].filter(Boolean).join(' - ') || t(`contactsPage.channels.${channelKind(contact.channel)}`, { defaultValue: contact.channel })}
        meta={
          <>
            <Link
              to="/contacts"
              className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60"
            >
              <ArrowLeft size={12} />
              {t('contactsPage.allContacts')}
            </Link>
            {threads[0] ? (
              <Link
                to={inboxPath('open', String(threads[0].id))}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  canComposeToAddress(contact.channel, contact.address)
                    ? 'border border-border/60 text-text-secondary hover:bg-bg-hover/60'
                    : 'bg-accent text-accent-fg hover:bg-accent-hover'
                }`}
                title={t('contactsPage.openConversationHint')}
              >
                <MessageSquare size={12} />
                {t('contactsPage.openConversation')}
              </Link>
            ) : null}
            {canComposeToAddress(contact.channel, contact.address) ? (
              <Link
                to={composeEmailPath({ to: contact.address })}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-fg transition-colors hover:bg-accent-hover"
                title={t('contactsPage.writeEmailHint')}
              >
                <Mail size={12} />
                {t('contactsPage.writeEmail')}
              </Link>
            ) : null}
            {contact.status !== 'approved' ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void setStatus('approved')}
                className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-status-success disabled:opacity-50"
              >
                <ShieldCheck size={12} />
                {t('contactsPage.approve')}
              </button>
            ) : null}
            {contact.status !== 'blocked' ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void setStatus('blocked')}
                className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-status-error disabled:opacity-50"
              >
                <ShieldBan size={12} />
                {t('contactsPage.block')}
              </button>
            ) : null}
            <button
              type="button"
              disabled={saving}
              onClick={() => void removeContact()}
              className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:border-status-error/50 hover:text-status-error disabled:opacity-50"
            >
              <Trash2 size={12} />
              {t('contactsPage.delete')}
            </button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2.5">
              <DomainFavicon
                email={contact.address}
                name={contact.displayName || contact.address}
                size={32}
              />
              <h2 className="truncate text-[14px] font-semibold text-text-heading">{t('contactsPage.profile')}</h2>
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${STATUS_STYLE[contact.status]}`}
            >
              {contactStatusLabel(contact.status, t)}
            </span>
          </div>
          <div className="mt-3 space-y-3">
            <p className="flex items-center gap-2 text-[12.5px] text-text-secondary">
              <ChannelGlyph channel={contact.channel} size={13} />
              {isPlaceholderContactAddress(contact.address)
                ? t('contactsPage.widgetVisitor')
                : contact.address || t('contactsPage.noAddress')}
              <span className="ml-auto text-[11px] text-text-muted">
                <ChannelLabel
                  channel={contact.channel}
                  label={t(`contactsPage.channels.${channelKind(contact.channel)}`, { defaultValue: contact.channel })}
                  size={11}
                />
              </span>
            </p>
            <p className="text-[11px] text-text-muted">
              {lastSeenAt
                ? t('contactsPage.lastSeen', { time: timeAgo(lastSeenAt, t) })
                : t('contactsPage.neverSeen')}
            </p>
            {field(t('contactsPage.fieldName'), 'displayName', t('contactsPage.namePlaceholderFull'))}
            <div className="grid grid-cols-2 gap-3">
              {field(t('contactsPage.fieldCompany'), 'company', t('contactsPage.fieldCompany'))}
              {field(t('contactsPage.fieldTitle'), 'title', t('contactsPage.titlePlaceholder'))}
            </div>
            {contact.companyId ? (
              <Link
                to={`/contacts/companies/${contact.companyId}`}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent hover:underline"
              >
                <Building2 size={12} />
                {t('contactsPage.viewCompany')}
              </Link>
            ) : (
              <div className="space-y-1">
                <p className="text-[11px] text-text-muted">{t('contactsPage.noCompanyHint')}</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  <Link
                    to="/contacts?view=companies"
                    className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent hover:underline"
                  >
                    <Building2 size={12} />
                    {t('contactsPage.viewCompanies')}
                  </Link>
                  <span className="text-[11px] text-text-muted">{t('contactsPage.linkContactsHint')}</span>
                </div>
              </div>
            )}
            {field(t('contactsPage.fieldPhone'), 'phone', t('contactsPage.phonePlaceholder'))}
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{t('contactsPage.notes')}</span>
              <textarea
                value={draft.notes}
                onChange={(e) => {
                  setDraft((prev) => ({ ...prev, notes: e.target.value }))
                  setDirty(true)
                }}
                rows={4}
                placeholder={t('contactsPage.notesPlaceholder')}
                className="mt-1 w-full resize-none rounded-md border border-border bg-bg-surface px-2.5 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
              />
            </label>
            {dirty ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                <Check size={12} />
                {saving ? t('contactsPage.saving') : t('contactsPage.saveChanges')}
              </button>
            ) : null}
          </div>
        </section>

        <section className="rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card">
          <h2 className="text-[14px] font-semibold text-text-heading">{t('contactsPage.conversations')}</h2>
          <p className="text-[12px] text-text-muted">
            {t('contactsPage.threadCount', { count: threads.length })}
          </p>
          <div className="mt-3 space-y-1.5">
            {threads.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center">
                <p className="text-[12px] text-text-muted">{t('contactsPage.noConversations')}</p>
                <p className="mt-1 text-[11px] text-text-muted">{t('contactsPage.noConversationsHint')}</p>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  {canComposeToAddress(contact.channel, contact.address) ? (
                    <Link
                      to={composeEmailPath({ to: contact.address })}
                      className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-accent-fg hover:bg-accent-hover"
                    >
                      {t('contactsPage.writeEmail')}
                    </Link>
                  ) : (
                    <Link
                      to="/settings/channels"
                      className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-accent-fg hover:bg-accent-hover"
                    >
                      {t('contactsPage.connectChannels')}
                    </Link>
                  )}
                  <Link
                    to={inboxPath('open')}
                    className="rounded-lg border border-border/60 px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-bg-hover/60"
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
                  className="group flex items-center gap-2.5 rounded-lg border border-border/40 bg-bg-elevated/45 px-3 py-2 transition-colors hover:border-accent/40"
                >
                  <MessageSquare size={13} className="shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-text-primary">
                      {thread.emailSubject || t('contactsPage.noSubject')}
                    </span>
                    <span className="block truncate text-[11px] text-text-muted">
                      {threadStatusLabel(thread.status, t)}
                      {thread.lastMessageAt ? ` - ${timeAgo(thread.lastMessageAt, t)}` : ''}
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
  const { t } = useTranslation('nav')
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
      toast.error(formatApiErrorMessage(err, t('contactsPage.loadCompanyError')))
    } finally {
      setLoading(false)
    }
  }, [token, companyId, t])

  useEffect(() => {
    void load()
  }, [load])

  useUnsavedChangesGuard(dirty, t('contactsPage.unsavedLeave'))

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
      toast.success(t('contactsPage.savedCompany'))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('contactsPage.saveCompanyError')))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!token || !company || saving) return
    if (!window.confirm(t('contactsPage.deleteCompanyConfirm', { label: company.name || company.domain }))) return
    setSaving(true)
    try {
      await deleteCompany(token, company.id)
      toast.success(t('contactsPage.deletedCompany'))
      navigate('/contacts')
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('contactsPage.deleteCompanyError')))
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <PageContent width="xl">
        <TableRowsSkeleton rows={5} className="pt-4" />
      </PageContent>
    )
  }

  if (!company) {
    return (
      <div className="pt-10 text-center">
        <p className="text-sm text-text-muted">{t('contactsPage.companyNotFound')}</p>
        <button
          type="button"
          onClick={() => navigate('/contacts')}
          className="mt-3 text-sm font-medium text-accent hover:underline"
        >
          {t('contactsPage.backToContacts')}
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
        subtitle={`${company.domain} - ${t('contactsPage.contactCount', { count: company.contactCount })}`}
        meta={
          <>
            <Link
              to="/contacts"
              className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60"
            >
              <ArrowLeft size={12} />
              {t('contactsPage.allContacts')}
            </Link>
            <button
              type="button"
              disabled={saving}
              onClick={() => void remove()}
              className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:border-status-error/50 hover:text-status-error disabled:opacity-50"
            >
              <Trash2 size={12} />
              {t('contactsPage.delete')}
            </button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card">
          <h2 className="flex items-center gap-2.5 text-[14px] font-semibold text-text-heading">
            <DomainFavicon host={company.domain} name={company.name || company.domain} size={28} />
            {t('contactsPage.companySection')}
          </h2>
          <div className="mt-3 space-y-3">
            {field(t('contactsPage.fieldName'), 'name', t('contactsPage.companyNamePlaceholder'))}
            {field(t('contactsPage.colWebsite'), 'website', t('contactsPage.websitePlaceholder'))}
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{t('contactsPage.notes')}</span>
              <textarea
                value={draft.notes}
                onChange={(e) => {
                  setDraft((prev) => ({ ...prev, notes: e.target.value }))
                  setDirty(true)
                }}
                rows={4}
                placeholder={t('contactsPage.companyNotesPlaceholder')}
                className="mt-1 w-full resize-none rounded-md border border-border bg-bg-surface px-2.5 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
              />
            </label>
            {dirty ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                <Check size={12} />
                {saving ? t('contactsPage.saving') : t('contactsPage.saveChanges')}
              </button>
            ) : null}
          </div>

          <h3 className="mt-5 text-[13px] font-semibold text-text-heading">{t('contactsPage.peopleSection')}</h3>
          <div className="mt-2 space-y-1.5">
            {company.contacts.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center">
                <p className="text-[12px] text-text-muted">{t('contactsPage.noLinkedContacts')}</p>
                <p className="mt-1 text-[11px] text-text-muted">{t('contactsPage.noLinkedContactsHint')}</p>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <Link
                    to="/settings/channels"
                    className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-accent-fg hover:bg-accent-hover"
                  >
                    {t('contactsPage.connectChannels')}
                  </Link>
                  <Link
                    to="/contacts"
                    className="rounded-lg border border-border/60 px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-bg-hover/60"
                  >
                    {t('contactsPage.browseContacts')}
                  </Link>
                </div>
              </div>
            ) : (
              company.contacts.map((c) => (
                <Link
                  key={c.id}
                  to={`/contacts/${c.id}`}
                  className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-bg-elevated/45 px-3 py-2 transition-colors hover:border-accent/40"
                >
                  <DomainFavicon email={c.address} name={c.displayName || c.address} size={24} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-text-primary">
                      {humanizeContactName(c.displayName, c.address, t('contactsPage.widgetVisitor')) ||
                        c.address}
                    </span>
                    <span className="block truncate text-[11px] text-text-muted">
                      {isPlaceholderContactAddress(c.address) ? t('contactsPage.widgetVisitor') : c.address}
                    </span>
                  </span>
                </Link>
              ))
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card">
          <h2 className="text-[14px] font-semibold text-text-heading">{t('contactsPage.conversations')}</h2>
          <p className="text-[12px] text-text-muted">{t('contactsPage.companyThreadsHint')}</p>
          <div className="mt-3 space-y-1.5">
            {company.threads.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center">
                <p className="text-[12px] text-text-muted">{t('contactsPage.noConversations')}</p>
                <p className="mt-1 text-[11px] text-text-muted">{t('contactsPage.noConversationsHint')}</p>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <Link
                    to="/settings/channels"
                    className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-accent-fg hover:bg-accent-hover"
                  >
                    {t('contactsPage.connectChannels')}
                  </Link>
                  <Link
                    to={inboxPath('open')}
                    className="rounded-lg border border-border/60 px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-bg-hover/60"
                  >
                    {t('contactsPage.openCommunication')}
                  </Link>
                </div>
              </div>
            ) : (
              company.threads.map((thread) => (
                <Link
                  key={String(thread.id)}
                  to={inboxPath('open', String(thread.id))}
                  className="group flex items-center gap-2.5 rounded-lg border border-border/40 bg-bg-elevated/45 px-3 py-2 transition-colors hover:border-accent/40"
                >
                  <MessageSquare size={13} className="shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-text-primary">
                      {thread.emailSubject || t('contactsPage.noSubject')}
                    </span>
                    <span className="block truncate text-[11px] text-text-muted">
                      {threadStatusLabel(thread.status, t)}
                      {thread.lastMessageAt ? ` - ${timeAgo(thread.lastMessageAt, t)}` : ''}
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

const STATUS_FILTERS: ReadonlyArray<{ key: ContactStatus | 'all'; labelKey: string; hintKey: string }> = [
  { key: 'all', labelKey: 'contactsPage.statusAll', hintKey: 'contactsPage.statusAllHint' },
  { key: 'approved', labelKey: 'contactsPage.statusApproved', hintKey: 'contactsPage.statusApprovedHint' },
  { key: 'pending', labelKey: 'contactsPage.statusPending', hintKey: 'contactsPage.statusPendingHint' },
  { key: 'blocked', labelKey: 'contactsPage.statusBlocked', hintKey: 'contactsPage.statusBlockedHint' },
]

function parseContactsView(raw: string | null): 'people' | 'companies' {
  return raw === 'companies' ? 'companies' : 'people'
}

export default function ContactsPage() {
  const { t } = useTranslation('nav')
  const { contactId, companyId } = useParams<{ contactId?: string; companyId?: string }>()
  const { token } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [view, setView] = useState<'people' | 'companies'>(() =>
    companyId ? 'companies' : parseContactsView(searchParams.get('view')),
  )
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ContactStatus | 'all'>('all')
  const [createOpen, setCreateOpen] = useState(() => searchParams.get('new') === '1')
  const [createDraft, setCreateDraft] = useState({
    channel: 'email',
    address: searchParams.get('address')?.trim() ?? '',
    displayName: '',
    company: '',
  })
  const [bulkBusy, setBulkBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [backfilling, setBackfilling] = useState(false)

  const handleViewChange = useCallback(
    (next: 'people' | 'companies') => {
      setView(next)
      const params = new URLSearchParams(searchParams)
      if (next === 'people') params.delete('view')
      else params.set('view', 'companies')
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  useEffect(() => {
    if (companyId) return
    const fromUrl = parseContactsView(searchParams.get('view'))
    setView((current) => (current === fromUrl ? current : fromUrl))
  }, [searchParams, companyId])

  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    setCreateOpen(true)
    const seeded = searchParams.get('address')?.trim()
    if (seeded) setCreateDraft((prev) => ({ ...prev, address: seeded }))
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    next.delete('address')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

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
        const [rows, inbox] = await Promise.all([
          listContacts(token, {
            ...(search.trim() ? { search: search.trim() } : {}),
            ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
          }),
          listSignalThreads(token, { perPage: 80 }).catch(() => ({ items: [] as InboxThread[] })),
        ])
        setContacts(enrichContactsFromThreads(rows, inbox.items))
      }
    } catch (err) {
      setContacts([])
      setCompanies([])
      setListError(err instanceof Error ? err.message : t('contactsPage.couldNotLoad'))
    } finally {
      setLoading(false)
    }
  }, [token, search, statusFilter, view, t])

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
          ? t('contactsPage.linkSuccess', { count: result.linked })
          : t('contactsPage.linkNone'),
      )
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('contactsPage.linkError')))
    } finally {
      setBackfilling(false)
    }
  }

  useEffect(() => {
    if (view !== 'companies' || loading || listError || companies.length > 0 || backfilling) return
    if (sessionStorage.getItem('bokito.contacts.backfillTried') === '1') return
    sessionStorage.setItem('bokito.contacts.backfillTried', '1')
    void handleBackfill()
    // Run once when the companies view first lands empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, loading, listError, companies.length])

  const handleCreate = async () => {
    if (!token || creating) return
    const address = createDraft.address.trim()
    if (!address) {
      setCreateError(t('contactsPage.addressRequired'))
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const created = await createContact(token, {
        channel: createDraft.channel,
        address,
        display_name: createDraft.displayName.trim(),
        company: createDraft.company.trim(),
      })
      setCreateOpen(false)
      setCreateDraft({ channel: 'email', address: '', displayName: '', company: '' })
      toast.success(t('contactsPage.created'))
      if (created) navigate(`/contacts/${created.id}`)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t('contactsPage.createError'))
    } finally {
      setCreating(false)
    }
  }

  const handleBulkStatus = async (status: ContactStatus) => {
    if (!token || bulkBusy) return
    const pending = contacts.filter((row) => row.status === 'pending')
    if (pending.length === 0) return
    setBulkBusy(true)
    try {
      await Promise.all(pending.map((row) => updateContact(token, row.id, { status })))
      toast.success(t('contactsPage.bulkUpdated', { count: pending.length }))
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('contactsPage.bulkError')))
    } finally {
      setBulkBusy(false)
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
      <PageGuideBanner page="contacts" className="mb-4" />
      <ContentHeader
        title={t('tabs.contacts.title')}
        subtitle={t('tabs.contacts.subtitle')}
        meta={
          <>
            <button
              type="button"
              onClick={() => void load()}
              className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              {t('contactsPage.refresh')}
            </button>
            {view === 'companies' ? (
              <button
                type="button"
                disabled={backfilling}
                onClick={() => void handleBackfill()}
                className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 disabled:opacity-50"
              >
                {backfilling ? <Loader2 size={12} className="animate-spin" /> : <Building2 size={12} />}
                {t('contactsPage.linkContacts')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-fg transition-colors hover:bg-accent-hover"
              >
                <Plus size={12} />
                {t('contactsPage.newContact')}
              </button>
            )}
          </>
        }
      />

      <div className="mb-3 flex items-center gap-2 rounded-lg border border-border/60 bg-bg-surface px-3 py-2 focus-within:border-accent/50">
        <Search size={14} className="shrink-0 text-text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={
            view === 'companies'
              ? t('contactsPage.searchCompanies')
              : t('contactsPage.searchPeople')
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
              onClick={() => handleViewChange(v)}
              className={
                view === v
                  ? 'rounded-md bg-accent/15 px-2.5 py-1 text-[12px] font-medium text-accent'
                  : 'rounded-md px-2.5 py-1 text-[12px] text-text-secondary hover:text-text-primary'
              }
            >
              {v === 'people' ? t('contactsPage.people') : t('contactsPage.companies')}
            </button>
          ))}
        </div>
        {view === 'people'
          ? STATUS_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                title={t(f.hintKey)}
                onClick={() => setStatusFilter(f.key)}
                className={
                  statusFilter === f.key
                    ? 'rounded-full bg-accent/15 px-2.5 py-0.5 text-[12px] font-medium text-accent'
                    : 'rounded-full bg-bg-hover/60 px-2.5 py-0.5 text-[12px] text-text-secondary hover:text-text-primary'
                }
              >
                {t(f.labelKey)}
              </button>
            ))
          : null}
      </div>
      {view === 'people' && statusFilter === 'pending' ? (
        <div className="-mt-2 mb-3 flex flex-wrap items-center gap-2">
          <p className="text-[11px] text-text-muted">{t('contactsPage.statusPendingHint')}</p>
          {sorted.length > 0 ? (
            <>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => void handleBulkStatus('approved')}
                className="rounded-lg border border-border/60 px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:text-text-primary disabled:opacity-50"
              >
                {t('contactsPage.approveAll')}
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => void handleBulkStatus('blocked')}
                className="rounded-lg border border-border/60 px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:text-status-error disabled:opacity-50"
              >
                {t('contactsPage.blockAll')}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {createOpen ? (
        <div className="mb-4 rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-text-heading">{t('contactsPage.newContact')}</h2>
            <button
              type="button"
              aria-label={t('contactsPage.closeAria')}
              onClick={() => setCreateOpen(false)}
              className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-text-primary"
            >
              <X size={14} />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <select
              aria-label={t('contactsPage.channelLabel')}
              value={createDraft.channel}
              onChange={(e) => setCreateDraft((p) => ({ ...p, channel: e.target.value }))}
              className="rounded-md border border-border bg-bg-surface px-2.5 py-1.5 text-[13px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/50"
            >
              {(['email', 'whatsapp', 'widget', 'slack'] as const).map((channel) => (
                <option key={channel} value={channel}>
                  {t(`contactsPage.channels.${channel}`)}
                </option>
              ))}
            </select>
            <input
              value={createDraft.address}
              onChange={(e) => setCreateDraft((p) => ({ ...p, address: e.target.value }))}
              placeholder={t(
                createDraft.channel === 'whatsapp'
                  ? 'contactsPage.whatsappPlaceholder'
                  : createDraft.channel === 'widget'
                    ? 'contactsPage.widgetPlaceholder'
                    : createDraft.channel === 'slack'
                      ? 'contactsPage.slackPlaceholder'
                      : 'contactsPage.emailPlaceholder',
              )}
              className="rounded-md border border-border bg-bg-surface px-2.5 py-1.5 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
            <input
              value={createDraft.displayName}
              onChange={(e) => setCreateDraft((p) => ({ ...p, displayName: e.target.value }))}
              placeholder={t('contactsPage.namePlaceholder')}
              className="rounded-md border border-border bg-bg-surface px-2.5 py-1.5 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
            <input
              value={createDraft.company}
              onChange={(e) => setCreateDraft((p) => ({ ...p, company: e.target.value }))}
              placeholder={t('contactsPage.companyPlaceholder')}
              className="rounded-md border border-border bg-bg-surface px-2.5 py-1.5 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
          </div>
          {createError ? <p className="mt-2 text-[12px] text-status-error">{createError}</p> : null}
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              disabled={creating || !createDraft.address.trim()}
              onClick={() => void handleCreate()}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {creating ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              {creating ? t('contactsPage.creating') : t('contactsPage.create')}
            </button>
          </div>
        </div>
      ) : null}

      {loading && (view === 'companies' ? companies.length === 0 : contacts.length === 0) ? (
        <TableRowsSkeleton rows={8} />
      ) : listError ? (
        <div className="rounded-xl border border-dashed border-status-error/40 px-4 py-12 text-center">
          <UserRound size={22} className="mx-auto text-text-muted" />
          <h2 className="mt-3 text-[15px] font-semibold text-text-heading">{t('contactsPage.couldNotLoad')}</h2>
          <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-text-muted">{listError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 rounded-lg border border-border/60 px-3 py-1.5 text-[12px] font-medium text-text-secondary hover:border-accent/40 hover:text-text-primary"
          >
            {t('contactsPage.tryAgain')}
          </button>
        </div>
      ) : view === 'companies' ? (
        companies.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 px-4 py-12 text-center">
            <Building2 size={22} className="mx-auto text-text-muted" />
            <h2 className="mt-3 text-[15px] font-semibold text-text-heading">
              {search.trim() ? t('contactsPage.noMatchingCompanies') : t('contactsPage.noCompanies')}
            </h2>
            <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-text-muted">
              {search.trim()
                ? t('contactsPage.tryDifferentSearch')
                : t('contactsPage.noCompaniesHint')}
            </p>
            {search.trim() ? null : (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  disabled={backfilling}
                  onClick={() => void handleBackfill()}
                  className="rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50"
                >
                  {backfilling ? t('contactsPage.linking') : t('contactsPage.linkContacts')}
                </button>
                <Link
                  to="/contacts"
                  className="rounded-lg border border-border/60 px-3.5 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
                >
                  {t('contactsPage.openPeople')}
                </Link>
                <Link
                  to={inboxPath('open')}
                  className="rounded-lg border border-border/60 px-3.5 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
                >
                  {t('contactsPage.openCommunication')}
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/60 bg-bg-surface shadow-card">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border/60 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-2.5">{t('contactsPage.colCompany')}</th>
                  <th className="hidden px-4 py-2.5 sm:table-cell">{t('contactsPage.colDomain')}</th>
                  <th className="hidden px-4 py-2.5 md:table-cell">{t('contactsPage.colWebsite')}</th>
                  <th className="px-4 py-2.5 text-right">{t('contactsPage.colContacts')}</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((company) => (
                  <tr
                    key={company.id}
                    onClick={() => navigate(`/contacts/companies/${company.id}`)}
                    className="cursor-pointer border-b border-border/40 transition-colors last:border-b-0 hover:bg-bg-hover/45"
                  >
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2.5">
                        <DomainFavicon host={company.domain} name={company.name || company.domain} size={28} />
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
            {search.trim() || statusFilter !== 'all' ? t('contactsPage.noMatchingContacts') : t('contactsPage.noContacts')}
          </h2>
          <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-text-muted">
            {search.trim() || statusFilter !== 'all'
              ? t('contactsPage.clearFilters')
              : t('contactsPage.noContactsHint')}
          </p>
          {search.trim() || statusFilter !== 'all' ? (
            <button
              type="button"
              onClick={() => {
                setSearch('')
                setStatusFilter('all')
              }}
              className="mt-4 rounded-lg border border-border/60 px-3.5 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
            >
              {t('contactsPage.clearFiltersAction')}
            </button>
          ) : (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <Link
                to="/settings/channels"
                className="rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
              >
                {t('contactsPage.connectEmail')}
              </Link>
              <Link
                to="/ai/assistant/external/installation"
                className="rounded-lg border border-border/60 px-3.5 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
              >
                {t('contactsPage.installWidget')}
              </Link>
              <Link
                to="/settings/setup"
                className="rounded-lg border border-border/60 px-3.5 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
              >
                {t('contactsPage.openSetup')}
              </Link>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="rounded-lg border border-border/60 px-3.5 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
              >
                {t('contactsPage.addManually')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-bg-surface shadow-card">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border/60 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                <th className="px-4 py-2.5">{t('contactsPage.colName')}</th>
                <th className="hidden px-4 py-2.5 sm:table-cell">{t('contactsPage.colChannel')}</th>
                <th className="hidden px-4 py-2.5 md:table-cell">{t('contactsPage.colCompany')}</th>
                <th className="hidden px-4 py-2.5 lg:table-cell">{t('contactsPage.colLastSeen')}</th>
                <th className="px-4 py-2.5 text-right">{t('contactsPage.colThreads')}</th>
                <th className="px-4 py-2.5 text-right">{t('contactsPage.colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((contact) => (
                <tr
                  key={contact.id}
                  onClick={() => navigate(`/contacts/${contact.id}`)}
                  className="group cursor-pointer border-b border-border/40 transition-colors last:border-b-0 hover:bg-bg-hover/45"
                >
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2.5">
                      <Link
                        to={`/contacts/${contact.id}`}
                        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <DomainFavicon
                          email={contact.address}
                          name={contact.displayName || contact.address}
                          size={28}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-text-primary">
                            {humanizeContactName(
                              contact.displayName,
                              contact.address,
                              t('contactsPage.widgetVisitor'),
                            ) ||
                              contact.address ||
                              t('contactsPage.noAddress')}
                          </span>
                          <span className="block truncate text-[11px] text-text-muted">
                            {isPlaceholderContactAddress(contact.address)
                              ? t('contactsPage.widgetVisitor')
                              : contact.address}
                          </span>
                        </span>
                      </Link>
                      {contact.threadCount > 0 ? (
                        <button
                          type="button"
                          title={t('contactsPage.openConversationHint')}
                          aria-label={t('contactsPage.openConversation')}
                          onClick={async (event) => {
                            event.stopPropagation()
                            if (!token) return
                            try {
                              const history = await findThreadsForContact(token, contact)
                              const latest = history[0]
                              navigate(latest ? inboxPath('open', String(latest.id)) : `/contacts/${contact.id}`)
                            } catch {
                              navigate(`/contacts/${contact.id}`)
                            }
                          }}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-accent/10 hover:text-accent"
                        >
                          <MessageSquare size={13} />
                        </button>
                      ) : null}
                      {canComposeToAddress(contact.channel, contact.address) ? (
                        <Link
                          to={composeEmailPath({ to: contact.address })}
                          onClick={(event) => event.stopPropagation()}
                          title={t('contactsPage.writeEmail')}
                          aria-label={t('contactsPage.writeEmail')}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-accent/10 hover:text-accent"
                        >
                          <Mail size={13} />
                        </Link>
                      ) : null}
                    </span>
                  </td>
                  <td className="hidden px-4 py-2.5 text-[12.5px] text-text-secondary sm:table-cell">
                    <ChannelLabel
                      channel={contact.channel}
                      label={t(`contactsPage.channels.${channelKind(contact.channel)}`, { defaultValue: contact.channel })}
                    />
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
                    {timeAgo(contact.lastSeenAt, t)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[12.5px] text-text-secondary">
                    {contact.threadCount > 0 ? (
                      <button
                        type="button"
                        className="text-accent hover:underline"
                        onClick={async (event) => {
                          event.stopPropagation()
                          if (!token) return
                          try {
                            const history = await findThreadsForContact(token, contact)
                            const latest = history[0]
                            navigate(latest ? inboxPath('open', String(latest.id)) : `/contacts/${contact.id}`)
                          } catch {
                            navigate(`/contacts/${contact.id}`)
                          }
                        }}
                      >
                        {contact.threadCount}
                      </button>
                    ) : canComposeToAddress(contact.channel, contact.address) ? (
                      <Link
                        to={composeEmailPath({ to: contact.address })}
                        onClick={(event) => event.stopPropagation()}
                        className="text-accent hover:underline"
                        title={t('contactsPage.writeEmailHint')}
                      >
                        {t('contactsPage.writeEmail')}
                      </Link>
                    ) : (
                      <span className="text-text-muted">{t('contactsPage.neverSeen')}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${STATUS_STYLE[contact.status]}`}
                    >
                      {contact.status === 'blocked' ? <ShieldBan size={10} /> : null}
                      {contact.status === 'approved' ? <Check size={10} /> : null}
                      {contactStatusLabel(contact.status, t)}
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
