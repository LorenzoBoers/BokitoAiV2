import { GRID_PATH } from '../lib/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { ENTITY_ICONS } from '../lib/entity-icons'
import { PageContent } from '../components/layout/PageContent'
import { OpenInGridButton } from '../components/org/OpenInGridButton'
import { PageHeader } from '../components/ui/page-header'
import { PageRelatedLinks } from '../components/layout/PageRelatedLinks'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { TagPill } from '../components/ui/TagPill'
import { CreateFolderDialog } from '../components/folders/CreateFolderDialog'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { EmptyState } from '../components/ui/empty-state'
import { SearchField } from '../components/ui/search-field'
import { LoadingBlock } from '../components/ui/loading-block'
import { EntityList, EntityRow } from '../components/ui/entity-row'
import { IconTile } from '../components/ui/icon-tile'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { useWorkspace } from '../context/WorkspaceContext'
import { listProjects, type CountedProject } from '../lib/projects-api'
import { workspaceBrandName } from '../lib/tenant-branding'

const FolderKanban = ENTITY_ICONS.project

function FolderRow({ project }: { project: CountedProject }) {
  const { t } = useTranslation('nav')
  const title = project.display_name || t('projects.page.unnamed')
  const path = (project.ancestors ?? []).map((ancestor) => ancestor.display_name || t('projects.page.unnamed'))

  return (
    <EntityRow
      href={`/folders/${project.id}`}
      aria-label={t('projects.page.openProject', {
        defaultValue: 'Open folder {{name}}',
        name: title,
      })}
      leading={<IconTile icon={FolderKanban} />}
      title={title}
      badges={
        project.tag_names?.length ? (
          <span className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden">
            {project.tag_names.map((tag) => (
              <TagPill key={tag} names={tag} tone="free" size="sm" title={tag} />
            ))}
          </span>
        ) : null
      }
      description={path.length ? <span data-testid="project-card-ancestors">{path.join(' / ')}</span> : null}
      meta={
        <span className="tabular-nums">
          {t('projects.detail.folderCounts', {
            open: project.open_count,
            closed: project.closed_count,
          })}
        </span>
      }
      trailing={
        project.open_tickets_count > 0 ? (
          <Badge variant="info" size="sm">
            {t('projects.page.openTickets', { count: project.open_tickets_count })}
          </Badge>
        ) : null
      }
    />
  )
}

export default function ProjectsPage() {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const { currentWorkspace } = useWorkspace()
  const [searchParams, setSearchParams] = useSearchParams()
  const isAdmin = useIsAdmin()
  const [projects, setProjects] = useState<CountedProject[]>([])
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
      const hay = [project.display_name, project.name, ...(project.tag_names ?? []), project.description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(needle)
    })
  }, [projects, query])

  return (
    <PageContent width="xl" className="space-y-4 py-1">
      <PageHeader
        title={t('projects.page.tenantTitle', { name: workspaceBrandName(currentWorkspace) })}
        subtitle={t('projects.page.subtitle')}
        className="mb-0"
        guide="projects"
        actions={<OpenInGridButton />}
        primaryAction={
          isAdmin ? (
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('projects.page.new')}
            </Button>
          ) : undefined
        }
      />

      {error ? <ApiErrorBanner message={error} onRetry={() => void load()} /> : null}
      {!isAdmin ? (
        <p className="rounded-lg border border-border bg-bg-input/40 px-3 py-2 text-xs text-text-muted">
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
        <LoadingBlock variant="skeleton" rows={6} />
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
            <Button size="sm" variant="secondary" onClick={() => setQuery('')}>
              {t('projects.page.clearSearch')}
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <EntityList className="px-1 py-1">
            {visibleProjects.map((project) => (
              <FolderRow key={project.id} project={project} />
            ))}
          </EntityList>
        </Card>
      )}

      <CreateFolderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(folderId) => navigate(`/folders/${folderId}`)}
      />

      <PageRelatedLinks
        links={[
          { to: GRID_PATH, label: t('orgCanvas.link') },
          { to: '/flows', label: t('pageGuides.related.workstreams', { defaultValue: 'Flows' }) },
          { to: '/settings/labels', label: t('pageGuides.related.categories', { defaultValue: 'Action tags' }) },
          {
            to: '/communication/inbox/open',
            label: t('pageGuides.related.communication', { defaultValue: 'Communication' }),
          },
        ]}
      />
    </PageContent>
  )
}
