import { Card } from '../ui/card'
import { useCallback, useEffect, useState } from 'react'
import { timeAgo } from '../../lib/time-ago'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { toastMovedToBin } from '../../lib/bin-toast'
import { Check, Trash2 } from 'lucide-react'

import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { ProfileSkeleton } from '../ui/skeleton'
import { ThreadStatusDot } from '../ui/ThreadStatusDot'
import { DomainFavicon } from '../ui/DomainFavicon'
import { PersonAvatar } from '../ui/PersonAvatar'
import { useConfirm } from '../ui/confirm-dialog'
import { useAuth } from '../../context/AuthContext'
import { PageHeader } from '../ui/page-header'
import { PageContent } from '../layout/PageContent'
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard'
import { deleteCompany, getCompany, setCompanyTags, updateCompany, type CompanyDetail as CompanyDetailData } from '../../lib/contacts-api'
import { threadStatusLabel } from '../../lib/status-labels'
import { humanizeContactName, isPlaceholderContactAddress } from '../../lib/contact-label'

import { inboxPath } from '../../lib/messages-paths'
import { ContactFolderChips, ThreadLookAt, ThreadTicketPrefix } from './ContactThreadMeta'
import { OwnerTagsField } from './OwnerTagsField'
import { TextLink } from '../ui/text-link'
import { Input } from '../ui/input'

export function CompanyDetailView({ companyId }: { companyId: string }) {
  const { t } = useTranslation('nav')
  const confirm = useConfirm()
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
    if (
      !(await confirm({
        description: t('contactsPage.deleteCompanyConfirm', { label: company.name || company.domain }),
        destructive: true,
      }))
    )
      return
    setSaving(true)
    try {
      await deleteCompany(token, company.id)
      toastMovedToBin(t('contactsPage.deletedCompany'), navigate)
      navigate('/contacts')
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('contactsPage.deleteCompanyError')))
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

  if (!company) {
    return (
      <div className="pt-10 text-center">
        <p className="text-sm text-text-muted">{t('contactsPage.companyNotFound')}</p>
        <TextLink
          type="button"
          onClick={() => navigate('/contacts')}
          className="mt-3 text-sm"
        >
          {t('contactsPage.backToContacts')}
        </TextLink>
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
        title={company.name || company.domain}
        subtitle={`${company.domain} - ${t('contactsPage.contactCount', { count: company.contactCount })}`}
        back={{ to: '/contacts', label: t('contactsPage.allContacts') }}
        actions={
          <>
            <button
              type="button"
              disabled={saving}
              onClick={() => void remove()}
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
            <h2 className="flex items-center gap-2.5 text-base font-semibold text-text-heading">
              <DomainFavicon host={company.domain} name={company.name || company.domain} size={28} />
              {t('contactsPage.companySection')}
            </h2>
            <div className="mt-3 space-y-3">
              {field(t('contactsPage.fieldName'), 'name', t('contactsPage.companyNamePlaceholder'))}
              {field(t('contactsPage.colWebsite'), 'website', t('contactsPage.websitePlaceholder'))}
              <label className="block">
                <span className="text-xs font-semibold text-text-muted">{t('contactsPage.notes')}</span>
                <textarea
                  value={draft.notes}
                  onChange={(e) => {
                    setDraft((prev) => ({ ...prev, notes: e.target.value }))
                    setDirty(true)
                  }}
                  rows={4}
                  placeholder={t('contactsPage.companyNotesPlaceholder')}
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
  
            <div className="mt-4 rounded-md border border-border px-3 py-2.5" data-testid="company-tags">
              <p className="mb-1.5 text-xs font-semibold text-text-muted">{t('contactsPage.tags', { defaultValue: 'Tags' })}</p>
              <OwnerTagsField
                tags={company.tags ?? []}
                disabled={saving}
                onChange={(names) => {
                  void (async () => {
                    if (!token) return
                    setSaving(true)
                    try {
                      const tags = await setCompanyTags(token, company.id, names)
                      setCompany((current) => (current ? { ...current, tags } : current))
                    } catch (err) {
                      toast.error(formatApiErrorMessage(err, t('contactsPage.saveCompanyError')))
                    } finally {
                      setSaving(false)
                    }
                  })()
                }}
              />
            </div>
  
            <h3 className="mt-5 text-sm font-semibold text-text-heading">{t('contactsPage.peopleSection')}</h3>
            {company.contactCount > company.contacts.length ? (
              <p className="mt-1 text-xs text-text-muted">
                {t('contactsPage.peopleTruncated', {
                  shown: company.contacts.length,
                  count: company.contactCount,
                })}
              </p>
            ) : null}
            <div className="mt-2 space-y-1.5">
              {company.contacts.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-3 py-5 text-center">
                  <p className="text-xs text-text-muted">{t('contactsPage.noLinkedContacts')}</p>
                  <p className="mt-1 text-xs text-text-muted">{t('contactsPage.noLinkedContactsHint')}</p>
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                    <Link
                      to="/settings/channels"
                      className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
                    >
                      {t('contactsPage.connectChannels')}
                    </Link>
                    <Link
                      to="/contacts"
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover"
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
                    className="flex items-center gap-2.5 rounded-md border border-transparent px-3 py-2 transition-colors hover:bg-bg-hover"
                  >
                    <PersonAvatar name={c.displayName} email={c.address} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate-fade text-sm font-medium text-text-primary">
                        {humanizeContactName(c.displayName, c.address, t('contactsPage.widgetVisitor')) ||
                          c.address}
                      </span>
                      <span className="block truncate-fade text-xs text-text-muted">
                        {isPlaceholderContactAddress(c.address) ? t('contactsPage.widgetVisitor') : c.address}
                      </span>
                    </span>
                  </Link>
                ))
              )}
            </div>
          </section>
        </Card>

        <Card asChild padding="default">
          <section>
            <h2 className="text-base font-semibold text-text-heading">{t('contactsPage.conversations')}</h2>
            <p className="text-xs text-text-muted">
              {company.threadsTruncated
                ? t('contactsPage.companyThreadsTruncated', { count: company.threads.length })
                : t('contactsPage.companyThreadsHint')}
            </p>
            <div className="mt-2">
              <ContactFolderChips threads={company.threads} />
            </div>
            <div className="mt-3 space-y-1.5">
              {company.threads.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-3 py-5 text-center">
                  <p className="text-xs text-text-muted">{t('contactsPage.noConversations')}</p>
                  <p className="mt-1 text-xs text-text-muted">{t('contactsPage.noConversationsHint')}</p>
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                    <Link
                      to="/settings/channels"
                      className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
                    >
                      {t('contactsPage.connectChannels')}
                    </Link>
                    <Link
                      to={inboxPath('open')}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover"
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
