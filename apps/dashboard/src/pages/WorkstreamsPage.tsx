import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ChevronRight, FolderKanban, Loader2, Plus, Workflow } from 'lucide-react'
import { PageContent } from '../components/layout/PageContent'
import { PageRelatedLinks } from '../components/layout/PageRelatedLinks'
import ContentHeader from '../components/shell/ContentHeader'
import { Badge } from '../components/ui/badge'
import { EmptyState } from '../components/ui/empty-state'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { TableRowsSkeleton } from '../components/ui/skeleton'
import { Hashtag } from '../components/ui/HashtagMark'
import { StageProgressIcon } from '../components/workstreams/StageProgressIcon'
import { useAuth } from '../context/AuthContext'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { flowTitle } from '../lib/flow-title'
import { normalizeHashtag, stripHash } from '../lib/hashtag'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import { listSignalTags, type SignalTag } from '../lib/signals-api'
import { stageLabel } from '../lib/tickets-api'
import { timeAgo } from '../lib/time-ago'
import { cn } from '../lib/utils'
import { createWorkstream, listWorkstreams, type WorkstreamRow } from '../lib/workstreams-api'
import { workstreamPath } from '../lib/workstream-ui'

/** Flows: one row per action tag pipeline, with live ticket load per stage. */
export default function WorkstreamsPage() {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const isAdmin = useIsAdmin()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workstreams, setWorkstreams] = useState<WorkstreamRow[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [createOpen, setCreateOpen] = useState(() => searchParams.get('new') === '1')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [wsRows, projectRows] = await Promise.all([
        listWorkstreams(),
        listProjects().catch(() => [] as ProjectRow[]),
      ])
      setWorkstreams(wsRows)
      setProjects(projectRows)
    } catch (err) {
      setError(formatApiErrorMessage(err, t('workstreamsPage.loadError')))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    if (!isAdmin) return
    setCreateOpen(true)
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
  }, [isAdmin, searchParams, setSearchParams])

  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])

  return (
    <PageContent width="xl" className="space-y-4 py-1">
      <ContentHeader
        title={t('workstreamsPage.title')}
        subtitle={t('workstreamsPage.subtitle')}
        className="mb-0"
        meta={
          isAdmin ? (
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('workstreamsPage.new')}
            </Button>
          ) : null
        }
      />

      {error ? <ApiErrorBanner message={error} onRetry={() => void load()} /> : null}

      {loading ? (
        <TableRowsSkeleton rows={6} />
      ) : workstreams.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title={t('workstreamsPage.emptyTitle')}
          description={t('workstreamsPage.emptyBody')}
          action={
            isAdmin ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1 h-4 w-4" aria-hidden />
                {t('workstreamsPage.new')}
              </Button>
            ) : undefined
          }
          footer={
            <Link to="/docs/ai/workstreams" className="text-xs font-medium text-accent hover:underline">
              {t('pageGuides.learnMore')}
            </Link>
          }
        />
      ) : (
        <ul className="space-y-2" data-testid="flows-list">
          {workstreams.map((ws) => (
            <li key={ws.id}>
              <FlowRow ws={ws} projectNames={projectNames} />
            </li>
          ))}
        </ul>
      )}

      {isAdmin && !loading && workstreams.length > 0 ? (
        <p className="text-xs text-text-muted">
          {t('workstreamsPage.categoriesHint')}{' '}
          <Link to="/settings/action-tags" className="font-medium text-accent hover:underline">
            {t('workstreamsPage.openCategories')}
          </Link>
        </p>
      ) : null}

      <CreateFlowDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => navigate(workstreamPath(id))}
      />

      <PageRelatedLinks
        links={[
          { to: '/projects', label: t('pageGuides.related.projects') },
          { to: '/settings/action-tags', label: t('pageGuides.related.categories') },
          { to: '/communication/inbox/open', label: t('pageGuides.related.communication') },
        ]}
      />
    </PageContent>
  )
}

function CreateFlowDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (workstreamId: string) => void
}) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [query, setQuery] = useState('')
  const [tags, setTags] = useState<SignalTag[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!open || !token) return
    let cancelled = false
    setLoading(true)
    setQuery('')
    void listSignalTags(token)
      .then((rows) => {
        if (!cancelled) setTags(rows)
      })
      .catch(() => {
        if (!cancelled) setTags([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, token])

  const available = useMemo(
    () => tags.filter((tag) => !tag.workstreamId).sort((a, b) => a.name.localeCompare(b.name)),
    [tags],
  )

  const normalized = normalizeHashtag(query)
  const matches = useMemo(() => {
    if (!normalized) return available
    return available.filter(
      (tag) =>
        tag.name.includes(normalized) || tag.description.toLowerCase().includes(normalized),
    )
  }, [available, normalized])

  const canCreateTag = Boolean(normalized) && matches.length === 0

  const createWithName = async (name: string) => {
    const tagName = normalizeHashtag(name)
    if (!tagName || creating) return
    setCreating(true)
    try {
      const created = await createWorkstream({ name: tagName })
      toast.success(t('workstreamsPage.created'))
      onOpenChange(false)
      onCreated(created.id)
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.createError')))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('workstreamsPage.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('workstreamsPage.dialogBody')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-accent">
              #
            </span>
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(stripHash(e.target.value))}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                if (canCreateTag) {
                  void createWithName(normalized)
                  return
                }
                if (matches.length === 1) void createWithName(matches[0].name)
              }}
              placeholder={t('workstreamsPage.dialogSearchPlaceholder')}
              aria-label={t('workstreamsPage.dialogSearchPlaceholder')}
              className="h-9 pl-6 text-sm"
              disabled={creating}
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-text-muted">
              <Loader2 size={14} className="animate-spin" aria-hidden />
              {t('workstreamsPage.dialogLoadingTags')}
            </div>
          ) : matches.length > 0 ? (
            <div
              className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto"
              role="listbox"
              aria-label={t('workstreamsPage.dialogTagsAria')}
            >
              {matches.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  role="option"
                  disabled={creating}
                  onClick={() => void createWithName(tag.name)}
                  className={cn(
                    'inline-flex max-w-full items-center gap-0.5 rounded-full border border-border/70 bg-bg-input/40 px-2.5 py-1',
                    'text-xs font-medium text-text-primary transition',
                    'hover:border-accent/50 hover:bg-accent/10 hover:text-accent',
                    'disabled:pointer-events-none disabled:opacity-60',
                  )}
                  title={tag.description || undefined}
                >
                  <Hashtag name={tag.name} category={tag.isCategory} className="text-xs" />
                </button>
              ))}
            </div>
          ) : canCreateTag ? (
            <div className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center">
              <p className="text-xs text-text-muted">{t('workstreamsPage.dialogNoMatch')}</p>
              <Button
                type="button"
                size="sm"
                className="mt-3"
                disabled={creating}
                onClick={() => void createWithName(normalized)}
              >
                {creating ? (
                  <Loader2 size={13} className="mr-1 animate-spin" aria-hidden />
                ) : (
                  <Plus size={13} className="mr-1" aria-hidden />
                )}
                {t('workstreamsPage.dialogCreateTag', { name: normalized })}
              </Button>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-xs text-text-muted">
              {available.length === 0
                ? t('workstreamsPage.dialogNoTags')
                : t('workstreamsPage.dialogTypeToFilter')}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={creating}>
            {t('workstreamsPage.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FlowRow({ ws, projectNames }: { ws: WorkstreamRow; projectNames: Map<string, string> }) {
  const { t } = useTranslation('nav')
  const counts = ws.ticket_counts ?? {}
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
  const names = ws.project_ids.map((id) => projectNames.get(id)).filter((n): n is string => Boolean(n))

  return (
    <Link
      to={workstreamPath(ws.id)}
      className={cn(
        'panel hover-lift group flex items-center gap-4 px-4 py-3 transition',
        'hover:border-border',
        !ws.enabled && 'opacity-70',
      )}
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-heading">
            <Hashtag name={flowTitle(ws)} category />
          </span>
          {!ws.enabled ? (
            <Badge variant="neutral" size="sm">
              {t('workstreamsPage.deactivated')}
            </Badge>
          ) : null}
          {ws.description ? (
            <span className="hidden min-w-0 truncate text-xs text-text-muted md:inline" title={ws.description}>
              {ws.description}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1" aria-label={t('workstreamsPage.list.stagesAria')}>
          {ws.stages.map((stage) => (
            <span
              key={stage.key}
              className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-bg-input/30 px-1.5 py-0.5 text-2xs text-text-secondary"
              title={stageLabel(stage, t)}
            >
              <StageProgressIcon kind={stage.kind} size={11} />
              <span className="max-w-[7rem] truncate">{stageLabel(stage, t)}</span>
              <span className="font-semibold tabular-nums text-text-heading">{counts[stage.key] ?? 0}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="hidden shrink-0 flex-col items-end gap-1 text-2xs text-text-muted sm:flex">
        <span className="tabular-nums">
          {t('workstreamsPage.list.tickets', { count: total })}
          {ws.last_activity_at ? ` · ${timeAgo(ws.last_activity_at, t)}` : ''}
        </span>
        {names.length > 0 ? (
          <span className="inline-flex max-w-[16rem] items-center gap-1 truncate">
            <FolderKanban size={11} aria-hidden />
            <span className="truncate">{names.join(', ')}</span>
          </span>
        ) : (
          <span className="italic">{t('workstreamsPage.meta.noProjects')}</span>
        )}
      </div>
      <ChevronRight size={15} className="shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}
