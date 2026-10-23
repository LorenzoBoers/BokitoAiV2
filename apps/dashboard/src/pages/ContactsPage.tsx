import { Spinner } from '../components/ui/spinner'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ENTITY_ICONS } from '../lib/entity-icons'
import { openEntityPath } from '../lib/open-entity'
import { Check, Mail, Plus, RefreshCw, ShieldBan } from 'lucide-react'

const Building2 = ENTITY_ICONS.company
const MessageSquare = ENTITY_ICONS.conversation
const UserRound = ENTITY_ICONS.contact
import { formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { CompanyTableSkeleton, DirectoryRowsSkeleton } from '../components/ui/skeleton'
import { ChannelLabel, channelKind } from '../components/ui/ChannelGlyph'
import { DomainFavicon } from '../components/ui/DomainFavicon'
import { PersonAvatar } from '../components/ui/PersonAvatar'
import { Badge } from '../components/ui/badge'
import { SearchField } from '../components/ui/search-field'
import { FilterChip } from '../components/ui/filter-chip'
import { SegmentedControl } from '../components/ui/segmented-control'
import { Button } from '../components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { useAuth } from '../context/AuthContext'
import ContentHeader from '../components/shell/ContentHeader'
import { PageContent } from '../components/layout/PageContent'
import { backfillCompanies, createContact, enrichContactsFromThreads, findThreadsForContact, bulkUpdatePendingContacts, listCompaniesPage, listContactsPage, type CompanyRow, type ContactRow, type ContactStatus } from '../lib/contacts-api'
import { parseContactsStatus, withContactsParam } from '../lib/contacts-list-query'
import { contactStatusLabel } from '../lib/status-labels'
import { humanizeContactName, isAnonymousContact, isPlaceholderContactAddress } from '../lib/contact-label'

import { inboxPath } from '../lib/messages-paths'
import { canComposeToAddress, composeEmailPath } from '../lib/compose-intent'
import { withoutParkedChannels } from '../lib/channel-surface'
import { useMailboxConnections } from '../hooks/useMailboxConnections'
import type { InboxThread } from '../lib/inbox-api'
import { listSignalThreads } from '../lib/signals-api'
import { TextLink } from '../components/ui/text-link'
import { STATUS_TONE, displayContactStatus } from '../components/contacts/contact-status'
import { ContactDetail } from '../components/contacts/ContactDetail'
import { CompanyDetailView } from '../components/contacts/CompanyDetailView'

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
  const { activeConnections } = useMailboxConnections()
  const mailboxReady = activeConnections.length > 0
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [view, setView] = useState<'people' | 'companies'>(() =>
    companyId ? 'companies' : parseContactsView(searchParams.get('view')),
  )
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [search, setSearch] = useState(() => searchParams.get('q')?.trim() ?? '')
  const [statusFilter, setStatusFilter] = useState<ContactStatus | 'all'>(() =>
    parseContactsStatus(searchParams.get('status')),
  )
  const { t: tc } = useTranslation('common')
  const filtered = Boolean(search.trim()) || statusFilter !== 'all'
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
  const [contactsNext, setContactsNext] = useState<number | null>(null)
  const [companiesNext, setCompaniesNext] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

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
    const query = searchParams.get('q')?.trim() ?? ''
    setSearch((current) => (current === query ? current : query))
    const status = parseContactsStatus(searchParams.get('status'))
    setStatusFilter((current) => (current === status ? current : status))
  }, [searchParams, companyId])

  useEffect(() => {
    if (companyId) return
    const timer = window.setTimeout(() => {
      setSearchParams((prev) => withContactsParam(prev, 'q', search.trim() || null), { replace: true })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [search, companyId, setSearchParams])

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
        const page = await listCompaniesPage(token, {
          ...(search.trim() ? { search: search.trim() } : {}),
        })
        setCompanies(page.companies)
        setCompaniesNext(page.nextOffset)
        setContactsNext(null)
      } else {
        const [page, inbox] = await Promise.all([
          listContactsPage(token, {
            ...(search.trim() ? { search: search.trim() } : {}),
            ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
          }),
          listSignalThreads(token, { perPage: 80 }).catch(() => ({ items: [] as InboxThread[] })),
        ])
        setContacts(enrichContactsFromThreads(page.contacts, inbox.items))
        setContactsNext(page.nextOffset)
        setCompaniesNext(null)
      }
    } catch (err) {
      setContacts([])
      setCompanies([])
      setContactsNext(null)
      setCompaniesNext(null)
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

  const loadMore = async () => {
    if (!token || loadingMore) return
    const offset = view === 'companies' ? companiesNext : contactsNext
    if (offset == null) return
    setLoadingMore(true)
    try {
      if (view === 'companies') {
        const page = await listCompaniesPage(token, {
          ...(search.trim() ? { search: search.trim() } : {}),
          offset,
        })
        setCompanies((prev) => {
          const seen = new Set(prev.map((row) => row.id))
          return [...prev, ...page.companies.filter((row) => !seen.has(row.id))]
        })
        setCompaniesNext(page.nextOffset)
      } else {
        const page = await listContactsPage(token, {
          ...(search.trim() ? { search: search.trim() } : {}),
          ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
          offset,
        })
        const inbox = await listSignalThreads(token, { perPage: 80 }).catch(() => ({ items: [] as InboxThread[] }))
        const extra = enrichContactsFromThreads(page.contacts, inbox.items)
        setContacts((prev) => {
          const seen = new Set(prev.map((row) => row.id))
          return [...prev, ...extra.filter((row) => !seen.has(row.id))]
        })
        setContactsNext(page.nextOffset)
      }
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('contactsPage.couldNotLoad')))
    } finally {
      setLoadingMore(false)
    }
  }

  const moreOffset = view === 'companies' ? companiesNext : contactsNext
  const loadMoreButton =
    moreOffset == null ? null : (
      <div className="flex justify-center border-t border-border px-4 py-3">
        <button
          type="button"
          disabled={loadingMore}
          onClick={() => void loadMore()}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
        >
          {loadingMore ? t('contactsPage.loadingMore') : t('contactsPage.loadMore')}
        </button>
      </div>
    )

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

  const handleBulkStatus = async (status: 'approved' | 'blocked') => {
    if (!token || bulkBusy) return
    setBulkBusy(true)
    try {
      const updated = await bulkUpdatePendingContacts(token, status, {
        search: search.trim() || undefined,
      })
      toast.success(t('contactsPage.bulkUpdated', { count: updated }))
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
        // Named people first; anonymous visitors sink so the list is scannable (F-79).
        const aAnon = isAnonymousContact(a.displayName, a.address) ? 1 : 0
        const bAnon = isAnonymousContact(b.displayName, b.address) ? 1 : 0
        if (aAnon !== bAnon) return aAnon - bAnon
        const at = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0
        const bt = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0
        return bt - at
      }),
    [contacts],
  )

  const anonymousCount = useMemo(
    () => contacts.filter((c) => isAnonymousContact(c.displayName, c.address)).length,
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
        guide="contacts"
        title={t('tabs.contacts.title')}
        subtitle={t('tabs.contacts.subtitle')}
        meta={
          <>
            <button
              type="button"
              onClick={() => void load()}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover"
            >
              {loading ? <Spinner size="sm" /> : <RefreshCw size={14} />}
              {t('contactsPage.refresh')}
            </button>
            {view === 'companies' ? (
              <button
                type="button"
                disabled={backfilling}
                onClick={() => void handleBackfill()}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover disabled:opacity-50"
              >
                {backfilling ? <Spinner size="sm" /> : <Building2 size={12} />}
                {t('contactsPage.linkContacts')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover"
              >
                <Plus size={14} />
                {t('contactsPage.newContact')}
              </button>
            )}
          </>
        }
      />

      <SearchField
        className="mb-3"
        value={search}
        onChange={setSearch}
        placeholder={
          view === 'companies'
            ? t('contactsPage.searchCompanies')
            : t('contactsPage.searchPeople')
        }
      />

      {view === 'people' && anonymousCount > 0 ? (
        <p className="mb-3 rounded-lg border border-status-warning/30 bg-status-warning/8 px-3 py-2 text-xs text-text-secondary">
          {t('contactsPage.anonymousGroupHint', { count: anonymousCount })}
        </p>
      ) : null}

      <div className="mb-4 flex items-center gap-1.5">
        <SegmentedControl
          className="mr-2"
          size="sm"
          value={view}
          onChange={handleViewChange}
          options={[
            { value: 'people', label: t('contactsPage.people') },
            { value: 'companies', label: t('contactsPage.companies') },
          ]}
        />
        {view === 'people'
          ? STATUS_FILTERS.map((f) => (
              <FilterChip
                key={f.key}
                title={t(f.hintKey)}
                active={statusFilter === f.key}
                onClick={() => {
                  setStatusFilter(f.key)
                  setSearchParams((prev) => withContactsParam(prev, 'status', f.key), { replace: true })
                }}
              >
                {t(f.labelKey)}
              </FilterChip>
            ))
          : null}
      </div>
      {view === 'people' && statusFilter === 'pending' ? (
        <div className="-mt-2 mb-3 flex flex-wrap items-center gap-2">
          <p className="text-xs text-text-muted">{t('contactsPage.statusPendingHint')}</p>
          {sorted.length > 0 ? (
            <>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => void handleBulkStatus('approved')}
                className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-text-secondary hover:text-text-primary disabled:opacity-50"
              >
                {t('contactsPage.approveAll')}
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => void handleBulkStatus('blocked')}
                className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-text-secondary hover:text-status-error disabled:opacity-50"
              >
                {t('contactsPage.blockAll')}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (creating) return
          setCreateOpen(open)
          if (!open) setCreateError(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('contactsPage.newContact')}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              void handleCreate()
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="new-contact-channel">{t('contactsPage.channelLabel')}</Label>
              <Select
                value={createDraft.channel}
                onValueChange={(value) => setCreateDraft((p) => ({ ...p, channel: value }))}
              >
                <SelectTrigger id="new-contact-channel" aria-label={t('contactsPage.channelLabel')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {withoutParkedChannels(['email', 'whatsapp', 'widget', 'slack'] as const).map((channel) => (
                    <SelectItem key={channel} value={channel}>
                      {t(`contactsPage.channels.${channel}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-contact-address">
                {t(
                  createDraft.channel === 'whatsapp'
                    ? 'contactsPage.whatsappPlaceholder'
                    : createDraft.channel === 'widget'
                      ? 'contactsPage.widgetPlaceholder'
                      : createDraft.channel === 'slack'
                        ? 'contactsPage.slackPlaceholder'
                        : 'contactsPage.emailPlaceholder',
                )}
              </Label>
              <Input
                id="new-contact-address"
                value={createDraft.address}
                onChange={(e) => setCreateDraft((p) => ({ ...p, address: e.target.value }))}
                autoFocus
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-contact-name">{t('contactsPage.namePlaceholder')}</Label>
              <Input
                id="new-contact-name"
                value={createDraft.displayName}
                onChange={(e) => setCreateDraft((p) => ({ ...p, displayName: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-contact-company">{t('contactsPage.companyPlaceholder')}</Label>
              <Input
                id="new-contact-company"
                value={createDraft.company}
                onChange={(e) => setCreateDraft((p) => ({ ...p, company: e.target.value }))}
              />
            </div>
            {createError ? <p className="text-xs text-status-error">{createError}</p> : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
                {tc('actions.cancel')}
              </Button>
              <Button type="submit" disabled={creating || !createDraft.address.trim()}>
                {creating ? <Spinner size="md" /> : null}
                {creating ? t('contactsPage.creating') : t('contactsPage.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {loading && (view === 'companies' ? companies.length === 0 : contacts.length === 0) ? (
        view === 'companies' ? <CompanyTableSkeleton rows={8} /> : <DirectoryRowsSkeleton rows={8} />
      ) : listError ? (
        <div className="rounded-lg border border-dashed border-status-error/40 px-4 py-12 text-center">
          <UserRound size={22} className="mx-auto text-text-muted" />
          <h2 className="mt-3 text-lg font-semibold text-text-heading">{t('contactsPage.couldNotLoad')}</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-text-muted">{listError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:border-border-light hover:text-text-primary"
          >
            {t('contactsPage.tryAgain')}
          </button>
        </div>
      ) : view === 'companies' ? (
        companies.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center">
            <Building2 size={22} className="mx-auto text-text-muted" />
            <h2 className="mt-3 text-lg font-semibold text-text-heading">
              {search.trim() ? t('contactsPage.noMatchingCompanies') : t('contactsPage.noCompanies')}
            </h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-text-muted">
              {search.trim()
                ? t('contactsPage.tryDifferentSearch')
                : t('contactsPage.noCompaniesHint')}
            </p>
            {search.trim() ? null : (
              <div className="mt-4 flex flex-col items-center gap-3">
                <button
                  type="button"
                  disabled={backfilling}
                  onClick={() => void handleBackfill()}
                  className="rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50"
                >
                  {backfilling ? t('contactsPage.linking') : t('contactsPage.linkContacts')}
                </button>
                <Link to="/docs/inbox/contacts" className="text-xs font-medium text-accent hover:underline">
                  {t('pageGuides.learnMore')}
                </Link>
              </div>
            )}
            {loadMoreButton}
          </div>
        ) : (
          <div className="panel overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border text-xs font-semibold text-text-muted">
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
                    className="cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-bg-hover/50"
                  >
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2.5">
                        <DomainFavicon host={company.domain} name={company.name || company.domain} size={28} />
                        <span className="truncate-fade text-sm font-medium text-text-primary">
                          {company.name || company.domain}
                        </span>
                      </span>
                    </td>
                    <td className="hidden px-4 py-2.5 text-sm text-text-secondary sm:table-cell">
                      {company.domain}
                    </td>
                    <td className="hidden px-4 py-2.5 text-sm text-text-secondary md:table-cell">
                      {company.website || '-'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-sm text-text-secondary">
                      {company.contactCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {loadMoreButton}
          </div>
        )
      ) : sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center">
          <UserRound size={22} className="mx-auto text-text-muted" />
          <h2 className="mt-3 text-lg font-semibold text-text-heading">
            {filtered ? t('contactsPage.noMatchingContacts') : t('contactsPage.noContacts')}
          </h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-text-muted">
            {filtered
              ? t('contactsPage.clearFilters')
              : t('contactsPage.noContactsHint')}
          </p>
          {filtered ? (
            <button
              type="button"
              onClick={() => {
                setSearch('')
                setStatusFilter('all')
              }}
              className="mt-4 rounded-lg border border-border px-3.5 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            >
              {t('contactsPage.clearFiltersAction')}
            </button>
          ) : (
            <div className="mt-4 flex flex-col items-center gap-3">
              <Link
                to="/settings/channels"
                className="rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
              >
                {t('contactsPage.connectEmail')}
              </Link>
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs">
                <TextLink
                  type="button"
                  onClick={() => setCreateOpen(true)}
                >
                  {t('contactsPage.addManually')}
                </TextLink>
                <Link to="/docs/inbox/contacts" className="font-medium text-accent hover:underline">
                  {t('pageGuides.learnMore')}
                </Link>
              </div>
            </div>
          )}
          {loadMoreButton}
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border text-xs font-semibold text-text-muted">
                <th className="px-4 py-2.5">{t('contactsPage.colName')}</th>
                <th className="hidden px-4 py-2.5 sm:table-cell">{t('contactsPage.colChannel')}</th>
                <th className="hidden px-4 py-2.5 md:table-cell">{t('contactsPage.colCompany')}</th>
                <th className="px-4 py-2.5 text-right">{t('contactsPage.colThreads')}</th>
                <th className="px-4 py-2.5 text-right">{t('contactsPage.colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((contact) => (
                <tr
                  key={contact.id}
                  onClick={() => navigate(`/contacts/${contact.id}`)}
                  className="group cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-bg-hover/50"
                >
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2.5">
                      <Link
                        to={`/contacts/${contact.id}`}
                        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <PersonAvatar name={contact.displayName} email={contact.address} size={32} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate-fade text-sm font-medium text-text-primary">
                            {humanizeContactName(
                              contact.displayName,
                              contact.address,
                              t('contactsPage.widgetVisitor'),
                            ) ||
                              contact.address ||
                              t('contactsPage.noAddress')}
                          </span>
                          <span className="block truncate-fade text-xs text-text-muted">
                            {isPlaceholderContactAddress(contact.address)
                              ? t('contactsPage.alsoSeenAsVisitor')
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
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-heading"
                        >
                          <MessageSquare size={13} />
                        </button>
                      ) : null}
                      {mailboxReady && canComposeToAddress(contact.channel, contact.address) ? (
                        <Link
                          to={composeEmailPath({ to: contact.address })}
                          onClick={(event) => event.stopPropagation()}
                          title={t('contactsPage.writeEmail')}
                          aria-label={t('contactsPage.writeEmail')}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-heading"
                        >
                          <Mail size={14} />
                        </Link>
                      ) : null}
                    </span>
                  </td>
                  <td className="hidden px-4 py-2.5 text-sm text-text-secondary sm:table-cell">
                    <ChannelLabel
                      channel={contact.channel}
                      label={t(`contactsPage.channels.${channelKind(contact.channel)}`, { defaultValue: contact.channel })}
                    />
                  </td>
                  <td className="hidden px-4 py-2.5 md:table-cell">
                    {contact.company && contact.companyId ? (
                      <Link
                        to={openEntityPath({ type: 'company', id: contact.companyId })}
                        onClick={(event) => event.stopPropagation()}
                        className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-accent hover:underline"
                        title={t('contactsPage.openCompany', { name: contact.company })}
                      >
                        <Building2 size={12} className="text-text-muted" />
                        {contact.company}
                      </Link>
                    ) : contact.company ? (
                      <span className="flex items-center gap-1.5 text-sm text-text-secondary">
                        <Building2 size={12} className="text-text-muted" />
                        {contact.company}
                      </span>
                    ) : (
                      <span className="text-xs text-text-muted">-</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm text-text-secondary">
                    {contact.threadCount > 0 ? (
                      <TextLink
                        type="button"
                        onClick={async (event: React.MouseEvent<HTMLButtonElement>) => {
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
                      </TextLink>
                    ) : mailboxReady && canComposeToAddress(contact.channel, contact.address) ? (
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
                    {(() => {
                      const shown = displayContactStatus(contact)
                      const awaiting = isAnonymousContact(contact.displayName, contact.address)
                      return (
                        <span className="inline-flex items-center gap-1.5">
                          <Badge
                            size="sm"
                            variant={STATUS_TONE[shown]}
                            icon={shown === 'blocked' ? ShieldBan : shown === 'approved' ? Check : undefined}
                          >
                            {awaiting
                              ? t('contactsPage.statusAwaitingEmail')
                              : contactStatusLabel(shown, t)}
                          </Badge>
                        </span>
                      )
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loadMoreButton}
        </div>
      )}
    </PageContent>
  )
}
