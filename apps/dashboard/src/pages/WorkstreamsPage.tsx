import { LoadingBlock } from '../components/ui/loading-block'
import { Spinner } from '../components/ui/spinner'
import { GRID_PATH } from '../lib/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ChevronRight, Plus } from 'lucide-react'
import { ENTITY_ICONS } from '../lib/entity-icons'
import { openEntityPath } from '../lib/open-entity'

const FolderKanban = ENTITY_ICONS.project
const Workflow = ENTITY_ICONS.flow
import { PageContent } from '../components/layout/PageContent'
import { PageRelatedLinks } from '../components/layout/PageRelatedLinks'
import { OpenInGridButton } from '../components/org/OpenInGridButton'
import ContentHeader from '../components/shell/ContentHeader'
import type { LabelColor } from '../lib/signals-api'
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
import { LabelMarkFields } from '../components/ui/LabelMark'
import { FLOW_LABEL_COLOR, FLOW_LABEL_ICON } from '../components/ui/label-marks'
import { TagPill } from '../components/ui/TagPill'
import { waitingStageFill } from '../lib/stage-order'
import { StageProgressIcon } from '../components/flows/StageProgressIcon'
import { useAuth } from '../context/AuthContext'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { flowActionTag, flowTitle } from '../lib/flow-title'
import { normalizeHashtag, stripHash } from '../lib/hashtag'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import { listSignalTags, type SignalTag } from '../lib/signals-api'
import { stageLabel } from '../lib/tickets-api'
import { timeAgo } from '../lib/time-ago'
import { cn } from '../lib/utils'
import { createWorkstream, listWorkstreams, type WorkstreamRow } from '../lib/flows-api'
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
          <>
            <OpenInGridButton />
            {isAdmin ? (
              <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {t('workstreamsPage.new')}
              </Button>
            ) : null}
          </>
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
            <Link to="/docs/ai/flows" className="text-xs font-medium text-accent hover:underline">
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
          <Link to="/settings/labels" className="font-medium text-accent hover:underline">
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
          { to: GRID_PATH, label: t('orgCanvas.link') },
          { to: '/folders', label: t('pageGuides.related.projects') },
          { to: '/settings/labels', label: t('pageGuides.related.categories') },
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
  const [choice, setChoice] = useState<{ name: string } | null>(null)
  const [markColor, setMarkColor] = useState<LabelColor>(FLOW_LABEL_COLOR)
  const [markIcon, setMarkIcon] = useState(FLOW_LABEL_ICON)

  useEffect(() => {
    if (!open || !token) return
    let cancelled = false
    setLoading(true)
    setQuery('')
    setChoice(null)
    setMarkColor(FLOW_LABEL_COLOR)
    setMarkIcon(FLOW_LABEL_ICON)
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

  const taken = useMemo(
    () => tags.filter((tag) => tag.workstreamId).sort((a, b) => a.name.localeCompare(b.name)),
    [tags],
  )
  const free = useMemo(
    () => tags.filter((tag) => !tag.workstreamId).sort((a, b) => a.name.localeCompare(b.name)),
    [tags],
  )

  const normalized = normalizeHashtag(query)
  const takenHit = useMemo(
    () => (normalized ? taken.find((tag) => tag.name === normalized) ?? null : null),
    [normalized, taken],
  )
  const freeMatches = useMemo(() => {
    if (!normalized) return []
    return free.filter(
      (tag) => tag.name.includes(normalized) || tag.description.toLowerCase().includes(normalized),
    )
  }, [free, normalized])

  const canUseNewName = Boolean(normalized) && !takenHit && freeMatches.length === 0

  const choose = (name: string) => {
    const tagName = normalizeHashtag(name)
    if (!tagName || taken.some((tag) => tag.name === tagName)) return
    setQuery(tagName)
    setChoice({ name: tagName })
    setMarkColor(FLOW_LABEL_COLOR)
    setMarkIcon(FLOW_LABEL_ICON)
  }

  const createFlow = async () => {
    const tagName = choice?.name
    if (!tagName || creating) return
    setCreating(true)
    try {
      const created = await createWorkstream({ name: tagName, color: markColor, icon: markIcon })
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
      <DialogContent className={cn('max-w-md', choice && 'max-w-lg')}>
        <DialogHeader>
          <DialogTitle>{t('workstreamsPage.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('workstreamsPage.dialogBody')}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto">
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-accent">
              #
            </span>
            <Input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(stripHash(e.target.value))
                setChoice(null)
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                if (choice) {
                  void createFlow()
                  return
                }
                if (takenHit) return
                if (canUseNewName) {
                  choose(normalized)
                  return
                }
                if (freeMatches.length === 1) choose(freeMatches[0].name)
              }}
              placeholder={t('workstreamsPage.dialogSearchPlaceholder')}
              aria-label={t('workstreamsPage.dialogSearchPlaceholder')}
              className="h-9 pl-6 text-sm"
              disabled={creating}
            />
          </div>

          {loading ? (
            <LoadingBlock className="py-6" label={t('workstreamsPage.dialogLoadingTags')} />
          ) : choice ? (
            <div className="flex items-center justify-between gap-2">
              <TagPill names={choice.name} tone="action" size="sm" color={markColor} icon={markIcon} selected />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={creating}
                onClick={() => setChoice(null)}
              >
                {t('workstreamsPage.dialogChooseOther')}
              </Button>
            </div>
          ) : !normalized ? (
            taken.length > 0 ? (
              <div
                className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto"
                role="listbox"
                aria-label={t('workstreamsPage.dialogTakenAria')}
              >
                {taken.map((tag) => (
                  <TagPill
                    key={tag.id}
                    names={tag.name}
                    tone="action"
                    size="sm"
                    color={tag.color}
                    icon={tag.icon}
                    disabled
                    className="pointer-events-none opacity-45"
                    title={t('workstreamsPage.dialogTakenTitle')}
                  />
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-text-muted">
                {t('workstreamsPage.dialogNoFlows')}
              </p>
            )
          ) : takenHit ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5" role="listbox" aria-label={t('workstreamsPage.dialogTakenAria')}>
                <TagPill
                  names={takenHit.name}
                  tone="action"
                  size="sm"
                  color={takenHit.color}
                  icon={takenHit.icon}
                  disabled
                  className="pointer-events-none opacity-45"
                  title={t('workstreamsPage.dialogTakenTitle')}
                />
              </div>
              <p className="text-center text-xs text-text-muted">
                {t('workstreamsPage.dialogAlreadyFlow', { name: takenHit.name })}
              </p>
            </div>
          ) : freeMatches.length > 0 ? (
            <div
              className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto"
              role="listbox"
              aria-label={t('workstreamsPage.dialogTagsAria')}
            >
              {freeMatches.map((tag) => (
                <TagPill
                  key={tag.id}
                  names={tag.name}
                  tone="free"
                  size="sm"
                  disabled={creating}
                  title={tag.description || undefined}
                  onClick={() => choose(tag.name)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center">
              <p className="text-xs text-text-muted">{t('workstreamsPage.dialogNoMatch')}</p>
              <Button type="button" size="sm" className="mt-3" disabled={creating} onClick={() => choose(normalized)}>
                <Plus size={13} className="mr-1" aria-hidden />
                {t('workstreamsPage.dialogCreateTag', { name: normalized })}
              </Button>
            </div>
          )}

          {choice ? (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-sm font-medium text-text-heading">{t('workstreamsPage.mark.title')}</p>
              <p className="text-xs text-text-muted">{t('workstreamsPage.mark.body')}</p>
              <LabelMarkFields
                name={choice.name}
                color={markColor}
                icon={markIcon}
                onColorChange={setMarkColor}
                onIconChange={setMarkIcon}
              />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={creating}>
            {t('workstreamsPage.cancel')}
          </Button>
          {choice ? (
            <Button type="button" onClick={() => void createFlow()} disabled={creating}>
              {creating ? <Spinner size="md" className="mr-1" /> : null}
              {t('workstreamsPage.create')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FlowRow({ ws, projectNames }: { ws: WorkstreamRow; projectNames: Map<string, string> }) {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const counts = ws.ticket_counts ?? {}
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
  const linked = ws.project_ids
    .map((id) => ({ id, name: projectNames.get(id) }))
    .filter((p): p is { id: string; name: string } => Boolean(p.name))
  const href = workstreamPath(ws.id)
  const title = flowTitle(ws)
  const actionTag = flowActionTag(ws)

  // The row opens the flow; the project chips inside open their folder.
  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={title}
      onClick={() => navigate(href)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          navigate(href)
        }
      }}
      className={cn(
        'panel hover-lift group flex cursor-pointer items-center gap-4 px-4 py-3 transition',
        'hover:border-border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
      )}
      data-testid="flow-row"
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Workflow size={16} className="shrink-0 text-text-muted" aria-hidden />
          <span className="min-w-0 truncate font-medium text-text-heading">{title}</span>
          {actionTag ? (
            <TagPill
              names={actionTag}
              tone="action"
              size="sm"
              color={(ws.tags?.[0]?.color || '') as LabelColor}
              icon={ws.tags?.[0]?.icon}
            />
          ) : null}
          {ws.description ? (
            <span className="hidden min-w-0 truncate text-xs text-text-muted md:inline" title={ws.description}>
              {ws.description}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1" aria-label={t('workstreamsPage.list.stagesAria')}>
          {ws.stages.map((stage, index) => (
            <span
              key={stage.key}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-bg-input/30 px-1.5 py-0.5 text-2xs text-text-secondary"
              title={stageLabel(stage, t)}
            >
              <StageProgressIcon kind={stage.kind} fill={waitingStageFill(ws.stages, index)} size={11} />
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
        {linked.length > 0 ? (
          <span className="flex max-w-[18rem] flex-wrap items-center justify-end gap-1" data-testid="flow-row-projects">
            {linked.slice(0, 3).map((project) => (
              <Link
                key={project.id}
                to={openEntityPath({ type: 'project', id: project.id })}
                className="inline-flex max-w-[9rem] items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-2xs text-text-secondary transition hover:border-accent/50 hover:text-accent"
                title={t('workstreamsPage.meta.openProject', { name: project.name })}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <FolderKanban size={11} aria-hidden />
                <span className="truncate">{project.name}</span>
              </Link>
            ))}
            {linked.length > 3 ? <span className="tabular-nums">+{linked.length - 3}</span> : null}
          </span>
        ) : (
          <span className="italic">{t('workstreamsPage.meta.noProjects')}</span>
        )}
      </div>
      <ChevronRight size={15} className="shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5" />
    </div>
  )
}
