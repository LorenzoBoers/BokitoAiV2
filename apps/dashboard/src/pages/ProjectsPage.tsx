import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { ENTITY_ICONS } from '../lib/entity-icons'
import { filtersetLocalNames, filtersetPlainLabel } from '../lib/folder-filter-tree'
import { PageContent } from '../components/layout/PageContent'
import { OpenInGridButton } from '../components/org/OpenInGridButton'
import ContentHeader from '../components/shell/ContentHeader'
import { PageRelatedLinks } from '../components/layout/PageRelatedLinks'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { TagPill } from '../components/ui/TagPill'
import { CreateFolderDialog } from '../components/folders/CreateFolderDialog'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { EmptyState } from '../components/ui/empty-state'
import { SearchField } from '../components/ui/search-field'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { useWorkspace } from '../context/WorkspaceContext'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import { workspaceBrandName } from '../lib/tenant-branding'

const FolderKanban = ENTITY_ICONS.project

function stopCard(event: { stopPropagation: () => void }) {
  event.stopPropagation()
}

function displayName(project: ProjectRow): string {
  const named = project.name.replace(/^#/, '').trim()
  if (named) return named
  if (project.tag_names?.length) {
    const parentNames = project.ancestors?.length
      ? project.ancestors[project.ancestors.length - 1]?.tag_names
      : null
    return filtersetPlainLabel(filtersetLocalNames(project.tag_names, parentNames))
  }
  return 'Folder'
}

function ProjectCard({ project }: { project: ProjectRow }) {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const openCount = project.open_count ?? 0
  const title = displayName(project)

  return (
    <Card
      role="link"
      tabIndex={0}
      aria-label={t('projects.page.openProject', {
        defaultValue: 'Open folder {{name}}',
        name: title,
      })}
      onClick={() => navigate(`/folders/${project.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigate(`/folders/${project.id}`)
        }
      }}
      interactive
      className="group flex flex-col gap-3 p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {project.ancestors && project.ancestors.length > 0 ? (
            <p className="truncate text-2xs text-text-muted" data-testid="project-card-ancestors">
              {project.ancestors.map((ancestor, index) => (
                <span key={ancestor.id}>
                  {index > 0 ? ' / ' : null}
                  <Link
                    to={`/folders/${ancestor.id}`}
                    className="hover:text-accent hover:underline"
                    onClick={stopCard}
                    onKeyDown={stopCard}
                  >
                    {ancestor.name.replace(/^#/, '')}
                  </Link>
                </span>
              ))}
            </p>
          ) : null}
          <p className="flex min-w-0 items-center gap-1.5 truncate-fade font-medium text-text-heading group-hover:text-accent">
            <FolderKanban size={16} className="shrink-0 text-text-muted" aria-hidden />
            <span className="min-w-0 truncate">{title}</span>
          </p>
          {project.tag_names?.length ? (
            <div
              className="mt-1.5 flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden"
              onClick={stopCard}
              onKeyDown={stopCard}
            >
              {project.tag_names.map((tag) => (
                <TagPill key={tag} names={tag} tone="free" size="sm" title={tag} />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-auto space-y-2 border-t border-border/50 pt-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
          <span className="tabular-nums">
            {t('projects.detail.folderCounts', {
              open: openCount,
              closed: project.closed_count ?? 0,
            })}
          </span>
          {(project.open_tickets_count ?? 0) > 0 ? (
            <Badge variant="info" className="px-1.5 py-0 text-2xs">
              {t('projects.page.openTickets', { count: project.open_tickets_count })}
            </Badge>
          ) : null}
        </div>
      </div>
    </Card>
  )
}

export default function ProjectsPage() {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const { currentWorkspace } = useWorkspace()
  const [searchParams, setSearchParams] = useSearchParams()
  const isAdmin = useIsAdmin()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(() => searchParams.get('new') === '1')
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setProjects(await listProjects())
    } catch (err) {
      setError(formatApiErrorMessage(err, t('projects.page.loadError')))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const fromUrl = searchParams.get('q') ?? ''
    setQuery((current) => (current === fromUrl ? current : fromUrl))
  }, [searchParams])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchParams((prev) => {
        const current = prev.get('q') ?? ''
        const nextValue = query.trim()
        if (current === nextValue) return prev
        const next = new URLSearchParams(prev)
        if (nextValue) next.set('q', nextValue)
        else next.delete('q')
        return next
      }, { replace: true })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query, setSearchParams])

  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    if (!isAdmin) return
    setCreateOpen(true)
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
  }, [isAdmin, searchParams, setSearchParams])

  const visibleProjects = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const roots = projects.filter((project) => !project.parent_id)
    if (!needle) return roots
    return projects.filter((project) => {
      const hay = [project.name, ...(project.tag_names ?? []), project.description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(needle)
    })
  }, [projects, query])

  return (
    <PageContent width="xl" className="space-y-4 py-1">
      <ContentHeader
        title={t('projects.page.tenantTitle', { name: workspaceBrandName(currentWorkspace) })}
        subtitle={t('projects.page.subtitle')}
        className="mb-0"
        meta={
          <>
            <OpenInGridButton />
            {isAdmin ? (
              <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {t('projects.page.new')}
              </Button>
            ) : null}
          </>
        }
      />

      {error ? <ApiErrorBanner message={error} onRetry={() => void load()} /> : null}
      {!isAdmin ? (
        <p className="rounded-lg border border-border/60 bg-bg-input/40 px-3 py-2 text-xs text-text-muted">
          {t('projects.page.readonlyBanner')}
        </p>
      ) : null}
      {projects.length > 0 ? (
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={t('projects.page.searchPlaceholder')}
          aria-label={t('projects.page.searchPlaceholder')}
          className="max-w-sm"
        />
      ) : null}

      {loading ? (
        <CardGridSkeleton />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={t('projects.page.emptyTitle')}
          description={t('projects.page.emptyBody')}
          action={
            isAdmin ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1 h-4 w-4" aria-hidden />
                {t('projects.page.new')}
              </Button>
            ) : undefined
          }
          footer={
            <Link to="/docs/ai/folders" className="text-xs font-medium text-accent hover:underline">
              {t('pageGuides.learnMore')}
            </Link>
          }
        />
      ) : visibleProjects.length === 0 ? (
        <EmptyState
          icon={Search}
          title={t('projects.page.emptyFiltered')}
          description={t('projects.page.emptyFilteredHint')}
          action={
            <Button size="sm" variant="outline" onClick={() => setQuery('')}>
              {t('projects.page.clearSearch')}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleProjects.map((project, index) => (
            <div
              key={project.id}
              className="stagger-in"
              style={{ '--stagger': Math.min(index, 11) } as CSSProperties}
            >
              <ProjectCard project={project} />
            </div>
          ))}
        </div>
      )}

      <CreateFolderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(folderId) => navigate(`/folders/${folderId}`)}
      />

      <PageRelatedLinks
        links={[
          { to: '/grid', label: t('orgCanvas.link') },
          { to: '/workstreams', label: t('pageGuides.related.workstreams', { defaultValue: 'Flows' }) },
          { to: '/settings/action-tags', label: t('pageGuides.related.categories', { defaultValue: 'Action tags' }) },
          {
            to: '/communication/inbox/open',
            label: t('pageGuides.related.communication', { defaultValue: 'Communication' }),
          },
        ]}
      />
    </PageContent>
  )
}
