import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ChevronRight, FolderKanban, Loader2, Plus, Workflow } from 'lucide-react'
import { PageContent } from '../components/layout/PageContent'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { TableRowsSkeleton } from '../components/ui/skeleton'
import { Hashtag } from '../components/ui/HashtagMark'
import { StageProgressIcon } from '../components/workstreams/StageProgressIcon'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { flowTitle } from '../lib/flow-title'
import { normalizeHashtag, stripHash } from '../lib/hashtag'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import { stageLabel } from '../lib/tickets-api'
import { timeAgo } from '../lib/time-ago'
import { cn } from '../lib/utils'
import { createWorkstream, listWorkstreams, type WorkstreamRow } from '../lib/workstreams-api'
import { workstreamPath } from '../lib/workstream-ui'

/** Flows: one row per action tag pipeline, with live ticket load per stage. */
export default function WorkstreamsPage() {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isAdmin = useIsAdmin()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workstreams, setWorkstreams] = useState<WorkstreamRow[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

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

  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])

  const create = async () => {
    const name = normalizeHashtag(newName)
    if (!name) return
    setCreating(true)
    try {
      const created = await createWorkstream({ name })
      setNewName('')
      toast.success(t('workstreamsPage.created'))
      navigate(workstreamPath(created.id))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.createError')))
    } finally {
      setCreating(false)
    }
  }

  return (
    <PageContent width="xl" className="space-y-4 py-1">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-text-heading">
            <Workflow size={22} className="text-text-muted" />
            {t('workstreamsPage.title')}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">{t('workstreamsPage.subtitle')}</p>
        </div>
        {isAdmin ? (
          <div className="flex items-center gap-2">
            <span className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-accent">
                #
              </span>
              <Input
                autoFocus={searchParams.get('new') === '1'}
                value={newName}
                onChange={(e) => setNewName(stripHash(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void create()
                }}
                placeholder={t('workstreamsPage.newPlaceholder')}
                aria-label={t('workstreamsPage.newPlaceholder')}
                className="h-9 w-56 pl-6 text-sm"
              />
            </span>
            <Button type="button" size="sm" disabled={creating || !newName.trim()} onClick={() => void create()}>
              {creating ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Plus size={13} className="mr-1" />}
              {t('workstreamsPage.create')}
            </Button>
          </div>
        ) : null}
      </header>

      {error ? <ApiErrorBanner message={error} onRetry={() => void load()} /> : null}

      {loading ? (
        <TableRowsSkeleton rows={6} />
      ) : workstreams.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-text-muted">
          {t('workstreamsPage.empty')}
        </p>
      ) : (
        <ul className="space-y-2" data-testid="flows-list">
          {workstreams.map((ws) => (
            <li key={ws.id}>
              <FlowRow ws={ws} projectNames={projectNames} />
            </li>
          ))}
        </ul>
      )}

      {isAdmin && !loading ? (
        <p className="text-xs text-text-muted">
          {t('workstreamsPage.categoriesHint')}{' '}
          <Link to="/settings/action-tags" className="font-medium text-accent hover:underline">
            {t('workstreamsPage.openCategories')}
          </Link>
        </p>
      ) : null}
    </PageContent>
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
        'group flex items-center gap-4 rounded-xl border border-border/50 bg-bg-elevated/40 px-4 py-3 transition',
        'hover:border-border hover:bg-bg-muted/40',
        !ws.enabled && 'opacity-70',
      )}
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-heading">
            <Hashtag name={flowTitle(ws)} category />
          </span>
          {!ws.enabled ? (
            <Badge variant="secondary" className="text-2xs">
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
