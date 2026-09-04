/**
 * Cases hub (`/cases`, NL "Signalen"): the operational queue of typed intake
 * plus the canonical type catalog.
 *
 * Queue rows deep-link into the Communication thread; quick actions run in a
 * slide-over so operators stay in the queue. Mirrors the Contacts dense-list
 * and Govern URL-tab patterns — this is not a second inbox.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowUpRight,
  Check,
  FolderKanban,
  Link2,
  Radar,
  RefreshCw,
  Search,
  Workflow,
  X,
} from 'lucide-react'
import { PageContent } from '../components/layout/PageContent'
import { PageGuideBanner } from '../components/layout/PageGuideBanner'
import ContentHeader from '../components/shell/ContentHeader'
import { CaseTypesCard } from '../components/cases/CaseTypesCard'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { EmptyState } from '../components/ui/empty-state'
import { Input } from '../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { TableRowsSkeleton } from '../components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Textarea } from '../components/ui/textarea'
import { formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { isTypingTarget } from '../hooks/useInboxListShortcuts'
import {
  getCaseStats,
  linkCase,
  listCases,
  listCaseTypes,
  patchCase,
  type CaseRow,
  type CaseStats,
  type CaseStatus,
  type CaseTypeRow,
} from '../lib/cases-api'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import { listWorkstreams, type WorkstreamRow } from '../lib/workstreams-api'
import { inboxPath } from '../lib/messages-paths'
import { cn } from '../lib/utils'

/** Status buckets for the queue pills (operator mental model, not raw statuses). */
const BUCKETS = ['needs_you', 'open', 'waiting', 'linked', 'done'] as const
type Bucket = (typeof BUCKETS)[number]

const BUCKET_STATUSES: Record<Bucket, CaseStatus[]> = {
  needs_you: ['waiting_operator', 'proposed'],
  open: ['open'],
  waiting: ['waiting_customer'],
  linked: ['linked'],
  done: ['closed', 'cancelled'],
}

function bucketForStatus(status: CaseStatus): Bucket {
  for (const bucket of BUCKETS) {
    if (BUCKET_STATUSES[bucket].includes(status)) return bucket
  }
  return 'open'
}

const STATUS_BADGE_CLASS: Record<Bucket, string> = {
  needs_you: 'bg-status-warning/15 text-status-warning',
  open: 'bg-accent/15 text-accent',
  waiting: 'bg-bg-muted text-text-secondary',
  linked: 'bg-ai/15 text-ai-ink',
  done: 'bg-status-success/15 text-status-success',
}

const CASES_TABS = new Set(['queue', 'types'])
const CASES_LAST_TAB_KEY = 'bokito.cases.lastTab'

function readLastCasesTab(): string {
  try {
    const stored = localStorage.getItem(CASES_LAST_TAB_KEY)
    if (stored && CASES_TABS.has(stored)) return stored
  } catch {
    /* ignore */
  }
  return ''
}

function writeLastCasesTab(next: string) {
  try {
    localStorage.setItem(CASES_LAST_TAB_KEY, next)
  } catch {
    /* ignore */
  }
}

function timeAgo(iso: string | null | undefined, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!iso) return '-'
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return t('casesPage.now', { defaultValue: 'now' })
  if (minutes < 60) return t('casesPage.minutesAgo', { defaultValue: '{{count}}m', count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('casesPage.hoursAgo', { defaultValue: '{{count}}h', count: hours })
  return t('casesPage.daysAgo', { defaultValue: '{{count}}d', count: Math.floor(hours / 24) })
}

export default function CasesPage() {
  const { t } = useTranslation('nav')
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab') ?? ''
  const [fallbackTab, setFallbackTab] = useState(() => readLastCasesTab() || 'queue')
  const tab = CASES_TABS.has(tabParam) ? tabParam : fallbackTab

  useEffect(() => {
    if (CASES_TABS.has(tabParam)) writeLastCasesTab(tabParam)
  }, [tabParam])

  const setTab = (next: string) => {
    writeLastCasesTab(next)
    setFallbackTab(next)
    const params = new URLSearchParams(searchParams)
    params.set('tab', next)
    setSearchParams(params, { replace: true })
  }

  // Queue state
  const [rows, setRows] = useState<CaseRow[]>([])
  const [stats, setStats] = useState<CaseStats | null>(null)
  const [types, setTypes] = useState<CaseTypeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [bucket, setBucket] = useState<Bucket>('needs_you')
  /** One-shot: land on the first non-empty bucket so Open cases aren't hidden behind an empty "Needs you". */
  const bucketAutoPickedRef = useRef(false)
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [selected, setSelected] = useState<CaseRow | null>(null)
  const [focusIndex, setFocusIndex] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cases, counts, typeRows] = await Promise.all([
        listCases({ q: query.trim() || undefined, caseTypeId: typeFilter || undefined, limit: 300 }),
        getCaseStats().catch(() => null),
        listCaseTypes().catch(() => [] as CaseTypeRow[]),
      ])
      setRows(cases)
      if (counts) setStats(counts)
      setTypes(typeRows)
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('casesPage.loadError', { defaultValue: 'Could not load cases.' })))
    } finally {
      setLoading(false)
    }
  }, [query, typeFilter, t])

  useEffect(() => {
    void load()
  }, [load])

  const bucketCounts = useMemo(() => {
    const counts: Record<Bucket, number> = { needs_you: 0, open: 0, waiting: 0, linked: 0, done: 0 }
    if (stats) {
      for (const bucketKey of BUCKETS) {
        counts[bucketKey] = BUCKET_STATUSES[bucketKey].reduce(
          (sum, status) => sum + (stats[status] ?? 0),
          0,
        )
      }
    }
    return counts
  }, [stats])

  useEffect(() => {
    if (bucketAutoPickedRef.current || !stats || loading) return
    bucketAutoPickedRef.current = true
    if (bucketCounts.needs_you > 0) return
    // Prefer live work over Done when Needs you is empty.
    const preferred: Bucket[] = ['open', 'waiting', 'linked', 'done']
    const next = preferred.find((key) => bucketCounts[key] > 0)
    if (next) setBucket(next)
  }, [stats, loading, bucketCounts])

  const visibleRows = useMemo(
    () => rows.filter((row) => BUCKET_STATUSES[bucket].includes(row.status)),
    [rows, bucket],
  )

  const alternateBucket = useMemo(
    () => BUCKETS.find((key) => key !== bucket && bucketCounts[key] > 0) ?? null,
    [bucket, bucketCounts],
  )

  useEffect(() => {
    setFocusIndex(0)
  }, [bucket, typeFilter, query])

  // J/K row navigation, Enter opens the slide-over — skipped while typing.
  const visibleRef = useRef(visibleRows)
  visibleRef.current = visibleRows
  const focusRef = useRef(focusIndex)
  focusRef.current = focusIndex
  useEffect(() => {
    if (tab !== 'queue') return
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      const key = event.key.toLowerCase()
      const list = visibleRef.current
      if (key === 'j') {
        event.preventDefault()
        setFocusIndex(Math.min(list.length - 1, focusRef.current + 1))
      } else if (key === 'k') {
        event.preventDefault()
        setFocusIndex(Math.max(0, focusRef.current - 1))
      } else if (key === 'enter') {
        const row = list[focusRef.current]
        if (row) {
          event.preventDefault()
          setSelected(row)
        }
      } else if (key === 'escape') {
        setSelected(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab])

  const enabledTypes = useMemo(() => types.filter((row) => row.enabled), [types])

  const bucketLabel = (value: Bucket) =>
    t(`casesPage.buckets.${value}`, {
      defaultValue: {
        needs_you: 'Needs you',
        open: 'Open',
        waiting: 'Waiting',
        linked: 'Linked',
        done: 'Done',
      }[value],
    })

  return (
    <PageContent width="xl" className="space-y-4">
      <PageGuideBanner page="cases" />
      <ContentHeader
        title={t('tabs.cases.title', { defaultValue: 'Cases' })}
        subtitle={t('tabs.cases.subtitle', { defaultValue: 'Typed intake on conversations, and the type catalog' })}
        meta={
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw size={13} className={cn('mr-1', loading && 'animate-spin')} />
            {t('casesPage.refresh', { defaultValue: 'Refresh' })}
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="queue">
            {t('casesPage.tabQueue', { defaultValue: 'Queue' })}
          </TabsTrigger>
          <TabsTrigger value="types">
            {t('casesPage.tabTypes', { defaultValue: 'Types' })}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'types' ? (
        <CaseTypesCard onTypesChanged={setTypes} />
      ) : (
        <div className="space-y-3">
          {/* Search + type filter */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('casesPage.searchPlaceholder', { defaultValue: 'Search title, summary or type' })}
                className="h-9 pl-8 text-sm"
              />
            </div>
            {enabledTypes.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <FilterChip active={typeFilter === ''} onClick={() => setTypeFilter('')}>
                  {t('casesPage.allTypes', { defaultValue: 'All types' })}
                </FilterChip>
                {enabledTypes.map((typeRow) => (
                  <FilterChip
                    key={typeRow.id}
                    active={typeFilter === typeRow.id}
                    onClick={() => setTypeFilter(typeFilter === typeRow.id ? '' : typeRow.id)}
                  >
                    {typeRow.name}
                  </FilterChip>
                ))}
              </div>
            ) : null}
          </div>

          {/* Status bucket pills */}
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label={t('casesPage.bucketsAria', { defaultValue: 'Case status' })}>
            {BUCKETS.map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={bucket === value}
                onClick={() => setBucket(value)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  bucket === value
                    ? 'border-accent/40 bg-accent/12 text-accent'
                    : 'border-border/60 text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary',
                )}
              >
                {bucketLabel(value)}
                <span className={cn('rounded-full px-1.5 text-[10px]', bucket === value ? 'bg-accent/15' : 'bg-bg-muted')}>
                  {bucketCounts[value]}
                </span>
              </button>
            ))}
          </div>

          {/* Queue list */}
          {loading && rows.length === 0 ? (
            <TableRowsSkeleton rows={6} />
          ) : visibleRows.length === 0 ? (
            <EmptyState
              icon={Radar}
              size="sm"
              title={
                alternateBucket
                  ? t('casesPage.queueEmptyBucketTitle', {
                      defaultValue: 'Nothing in {{bucket}}',
                      bucket: bucketLabel(bucket),
                    })
                  : t('casesPage.queueEmptyTitle', { defaultValue: 'Nothing here' })
              }
              description={
                alternateBucket
                  ? t('casesPage.queueEmptyBucketBody', {
                      defaultValue:
                        'This filter is empty. {{count}} case(s) are waiting in {{bucket}}.',
                      count: bucketCounts[alternateBucket],
                      bucket: bucketLabel(alternateBucket),
                    })
                  : t('casesPage.queueEmptyBody', {
                      defaultValue:
                        'Cases appear when agents or operators classify a conversation with an intake type.',
                    })
              }
              action={
                alternateBucket ? (
                  <Button type="button" size="sm" onClick={() => setBucket(alternateBucket)}>
                    {t('casesPage.viewBucket', {
                      defaultValue: 'View {{bucket}} ({{count}})',
                      bucket: bucketLabel(alternateBucket),
                      count: bucketCounts[alternateBucket],
                    })}
                  </Button>
                ) : (
                  <Button type="button" variant="outline" size="sm" onClick={() => setTab('types')}>
                    {t('casesPage.manageTypes', { defaultValue: 'Manage types' })}
                  </Button>
                )
              }
            />
          ) : (
            <ul className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60 bg-bg-elevated/40">
              {visibleRows.map((row, index) => (
                <li key={row.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelected(row)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setSelected(row)
                      }
                    }}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-bg-hover/50',
                      index === focusIndex && 'bg-bg-hover/40 shadow-[inset_2px_0_0_0_rgb(var(--color-accent))]',
                    )}
                  >
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {row.case_type?.name ?? '—'}
                    </Badge>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text-heading">
                        {row.title || row.case_type?.name || t('casesPage.untitled', { defaultValue: 'Untitled case' })}
                      </span>
                      <span className="block truncate text-[11px] text-text-muted">
                        {row.signal_subject || row.summary || '—'}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-text-muted">
                      {timeAgo(row.created_at, t)}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                        STATUS_BADGE_CLASS[bucketForStatus(row.status)],
                      )}
                    >
                      {t(`casesPage.statuses.${row.status}`, { defaultValue: row.status.replace(/_/g, ' ') })}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-text-muted">
            {t('casesPage.shortcutHint', { defaultValue: 'J/K to move, Enter to open, Esc to close.' })}
          </p>
        </div>
      )}

      {selected ? (
        <CaseSlideOver
          row={selected}
          onClose={() => setSelected(null)}
          onChanged={(next) => {
            setSelected(next)
            void load()
          }}
        />
      ) : null}
    </PageContent>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'border-accent/40 bg-accent/12 text-accent'
          : 'border-border/60 text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary',
      )}
    >
      {children}
    </button>
  )
}

/** Quick ops on one case without leaving the queue; deep-link opens the thread. */
function CaseSlideOver({
  row,
  onClose,
  onChanged,
}: {
  row: CaseRow
  onClose: () => void
  onChanged: (next: CaseRow) => void
}) {
  const { t } = useTranslation('nav')
  const [title, setTitle] = useState(row.title)
  const [summary, setSummary] = useState(row.summary)
  const [saving, setSaving] = useState(false)
  const [workstreams, setWorkstreams] = useState<WorkstreamRow[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [linkTarget, setLinkTarget] = useState('')

  useEffect(() => {
    setTitle(row.title)
    setSummary(row.summary)
    setLinkTarget('')
  }, [row.id, row.title, row.summary])

  useEffect(() => {
    void listWorkstreams().then(setWorkstreams).catch(() => setWorkstreams([]))
    void listProjects().then(setProjects).catch(() => setProjects([]))
  }, [])

  const patch = async (body: Parameters<typeof patchCase>[1]) => {
    setSaving(true)
    try {
      const next = await patchCase(row.id, body)
      onChanged({ ...row, ...next })
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('casesPage.updateError', { defaultValue: 'Could not update the case.' })))
    } finally {
      setSaving(false)
    }
  }

  const doLink = async () => {
    if (!linkTarget) return
    const [kind, targetId] = linkTarget.split(':')
    if ((kind !== 'workstream' && kind !== 'project') || !targetId) return
    setSaving(true)
    try {
      const next = await linkCase(row.id, { target_kind: kind, target_id: targetId })
      onChanged({ ...row, ...next })
      toast.success(t('casesPage.linked', { defaultValue: 'Linked.' }))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('casesPage.updateError', { defaultValue: 'Could not update the case.' })))
    } finally {
      setSaving(false)
    }
  }

  const dirty = title !== row.title || summary !== row.summary
  const isDone = row.status === 'closed' || row.status === 'cancelled'

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-border/60 bg-bg-elevated shadow-xl animate-page-enter"
        role="dialog"
        aria-label={row.title || row.case_type?.name || 'Case'}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border/50 px-4 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">{row.case_type?.name ?? '—'}</Badge>
              <span className="rounded-full bg-bg-muted px-2 py-0.5 text-[10px] font-medium text-text-secondary">
                {t(`casesPage.statuses.${row.status}`, { defaultValue: row.status.replace(/_/g, ' ') })}
              </span>
            </p>
            <h2 className="mt-1 truncate text-sm font-semibold text-text-heading">
              {row.title || row.case_type?.name || t('casesPage.untitled', { defaultValue: 'Untitled case' })}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-heading"
            aria-label={t('casesPage.close', { defaultValue: 'Close' })}
          >
            <X size={14} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {/* Primary deep-link: the conversation is the source of truth. */}
          <Button asChild size="sm" className="w-full">
            <Link to={inboxPath('all', row.signal_id)}>
              <ArrowUpRight size={14} className="mr-1" />
              {t('casesPage.openThread', { defaultValue: 'Open thread' })}
            </Link>
          </Button>

          {/* Status transitions */}
          <section>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              {t('casesPage.statusSection', { defaultValue: 'Status' })}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {row.status !== 'open' && !isDone ? (
                <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void patch({ status: 'open' })}>
                  {t('casesPage.actions.open', { defaultValue: 'Open' })}
                </Button>
              ) : null}
              {!isDone ? (
                <>
                  <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void patch({ status: 'closed' })}>
                    <Check size={13} className="mr-1" />
                    {t('casesPage.actions.close', { defaultValue: 'Close case' })}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => void patch({ status: 'cancelled' })}>
                    {t('casesPage.actions.dismiss', { defaultValue: 'Dismiss' })}
                  </Button>
                </>
              ) : (
                <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void patch({ status: 'open' })}>
                  {t('casesPage.actions.reopen', { defaultValue: 'Reopen' })}
                </Button>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-text-muted">
              {t('casesPage.lifecycleHint', { defaultValue: 'Closing a case does not close the conversation.' })}
            </p>
          </section>

          {/* Edit title/summary */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              {t('casesPage.detailsSection', { defaultValue: 'Details' })}
            </h3>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('casesPage.titlePlaceholder', { defaultValue: 'Title' })}
              className="h-8 text-sm"
            />
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
              placeholder={t('casesPage.summaryPlaceholder', { defaultValue: 'Summary' })}
              className="text-sm"
            />
            {dirty ? (
              <Button type="button" size="sm" disabled={saving} onClick={() => void patch({ title, summary })}>
                {t('casesPage.save', { defaultValue: 'Save' })}
              </Button>
            ) : null}
          </section>

          {/* Link to workstream / project */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              {t('casesPage.routingSection', { defaultValue: 'Routing' })}
            </h3>
            {row.workstream_id ? (
              <p className="flex items-center gap-1.5 text-xs text-text-secondary">
                <Workflow size={13} className="text-text-muted" />
                {t('casesPage.linkedWorkstream', { defaultValue: 'Linked to a workstream' })}
              </p>
            ) : null}
            {row.project_id ? (
              <p className="flex items-center gap-1.5 text-xs text-text-secondary">
                <FolderKanban size={13} className="text-text-muted" />
                {t('casesPage.linkedProject', { defaultValue: 'Linked to a project' })}
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <Select value={linkTarget} onValueChange={setLinkTarget}>
                <SelectTrigger className="h-8 flex-1 text-xs">
                  <SelectValue placeholder={t('casesPage.linkPlaceholder', { defaultValue: 'Link to workstream or project' })} />
                </SelectTrigger>
                <SelectContent>
                  {workstreams.map((ws) => (
                    <SelectItem key={`ws-${ws.id}`} value={`workstream:${ws.id}`}>
                      {t('casesPage.workstreamOption', { defaultValue: 'Workstream: {{name}}', name: ws.name })}
                    </SelectItem>
                  ))}
                  {projects.map((project) => (
                    <SelectItem key={`p-${project.id}`} value={`project:${project.id}`}>
                      {t('casesPage.projectOption', { defaultValue: 'Project: {{name}}', name: project.name })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" size="sm" disabled={saving || !linkTarget} onClick={() => void doLink()}>
                <Link2 size={13} className="mr-1" />
                {t('casesPage.link', { defaultValue: 'Link' })}
              </Button>
            </div>
          </section>
        </div>
      </aside>
    </>
  )
}
