import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import {
  Bot,
  FolderKanban,
  GitBranch,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { toast } from 'sonner'
import { PageContent } from '../components/layout/PageContent'
import { PageGuideBanner } from '../components/layout/PageGuideBanner'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import ConfirmDeleteDialog from '../components/ui/ConfirmDeleteDialog'
import { EmptyState } from '../components/ui/empty-state'
import { LoadingBlock } from '../components/ui/loading-block'
import { ProjectBudgetBar } from '../components/projects/ProjectBudgetBar'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { inboxPath } from '../lib/messages-paths'
import {
  createProject,
  deleteProject,
  getProjectBudget,
  listProjects,
  type ProjectBudgetResponse,
  type ProjectRow,
} from '../lib/projects-api'
import { indexStatusLabel } from '../lib/status-labels'

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const REPO_STATUS_VARIANT: Record<string, 'secondary' | 'destructive' | 'outline'> = {
  ready: 'secondary',
  indexing: 'outline',
  pending: 'outline',
  error: 'destructive',
}

function ProjectCard({
  project,
  budget,
  onDelete,
  canManage,
}: {
  project: ProjectRow
  budget: ProjectBudgetResponse | undefined
  onDelete: () => void
  canManage: boolean
}) {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const threadsHref = `${inboxPath('all')}?project_id=${encodeURIComponent(project.id)}`

  return (
    <Card
      role="link"
      tabIndex={0}
      aria-label={`Open project ${project.name}`}
      onClick={() => navigate(`/projects/${project.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') navigate(`/projects/${project.id}`)
      }}
      interactive
      className="group flex flex-col gap-3 p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-text-heading">{project.name}</p>
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={t('projects.page.actionsFor', { name: project.name })}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal size={15} />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-50 min-w-[180px] rounded-lg border border-border/60 bg-bg-surface p-1 shadow-overlay"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-text-primary outline-none data-[highlighted]:bg-bg-hover"
                onSelect={() => navigate(threadsHref)}
              >
                <MessageSquare size={14} />
                {t('projects.page.openThreads')}
              </DropdownMenu.Item>
              {project.po_agent ? (
                <DropdownMenu.Item
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-text-primary outline-none data-[highlighted]:bg-bg-hover"
                  onSelect={() => navigate(`/agents/${project.po_agent!.id}`)}
                >
                  <Bot size={14} />
                  {t('projects.page.openLead')}
                </DropdownMenu.Item>
              ) : null}
              {canManage ? (
                <>
                  <DropdownMenu.Separator className="my-1 h-px bg-border/60" />
                  <DropdownMenu.Item
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-status-error outline-none data-[highlighted]:bg-bg-hover"
                    onSelect={onDelete}
                  >
                    <Trash2 size={14} />
                    {t('projects.page.delete')}
                  </DropdownMenu.Item>
                </>
              ) : null}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      {project.description ? (
        <p className="line-clamp-2 text-sm text-text-secondary">{project.description}</p>
      ) : null}

      <div className="mt-auto space-y-2 border-t border-border/50 pt-3">
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <Bot size={13} className="shrink-0 text-text-muted" />
          {project.po_agent ? (
            <span className="truncate">{project.po_agent.name}</span>
          ) : (
            <span className="text-text-muted">{t('projects.page.noLead')}</span>
          )}
        </div>
        {project.agents && project.agents.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            {project.agents.slice(0, 4).map((agent) => (
              <span
                key={agent.agent_id}
                className="inline-flex max-w-[10rem] items-center truncate rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-text-secondary"
                title={agent.is_default ? t('projects.page.defaultAgent', { name: agent.name }) : agent.name}
              >
                {agent.name}
              </span>
            ))}
            {project.agents.length > 4 ? (
              <span className="text-[10px] text-text-muted">
                +{project.agents.length - 4}
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <GitBranch size={13} className="shrink-0 text-text-muted" />
          {project.github_repo_full_name ? (
            <>
              <span className="truncate">{project.github_repo_full_name}</span>
              {project.repo_index_status && project.repo_index_status !== 'none' ? (
                <Badge
                  variant={REPO_STATUS_VARIANT[project.repo_index_status] ?? 'outline'}
                  className="px-1.5 py-0 text-[10px]"
                >
                  {indexStatusLabel(project.repo_index_status, t)}
                </Badge>
              ) : null}
            </>
          ) : (
            <span className="text-text-muted">{t('projects.page.noRepo')}</span>
          )}
        </div>
        {budget ? <ProjectBudgetBar budget={budget} /> : null}
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
          <Link
            to={threadsHref}
            onClick={(event) => event.stopPropagation()}
            className="text-[11px] font-medium text-accent hover:underline"
          >
            {t('projects.page.openThreads')}
          </Link>
          {project.po_agent ? (
            <Link
              to={`/agents/${project.po_agent.id}`}
              onClick={(event) => event.stopPropagation()}
              className="text-[11px] font-medium text-accent hover:underline"
            >
              {t('projects.page.openLead')}
            </Link>
          ) : null}
          <Link
            to="/knowledge"
            onClick={(event) => event.stopPropagation()}
            className="text-[11px] font-medium text-accent hover:underline"
          >
            {t('projects.page.openKnowledge')}
          </Link>
        </div>
      </div>
    </Card>
  )
}

export default function ProjectsPage() {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [budgets, setBudgets] = useState<Record<string, ProjectBudgetResponse>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [query, setQuery] = useState('')
  const [showSlug, setShowSlug] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<ProjectRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const projectRows = await listProjects()
      setProjects(projectRows)
      const budgetEntries = await Promise.all(
        projectRows.map(async (p): Promise<[string, ProjectBudgetResponse] | null> => {
          try {
            return [p.id, await getProjectBudget(p.id)]
          } catch {
            return null
          }
        }),
      )
      setBudgets(Object.fromEntries(budgetEntries.filter((e): e is [string, ProjectBudgetResponse] => e !== null)))
    } catch (err) {
      setError(formatApiErrorMessage(err, t('projects.page.loadError')))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const create = async () => {
    const nextSlug = slug.trim() || slugify(name)
    if (!name.trim() || !nextSlug) return
    setCreating(true)
    try {
      const created = await createProject({
        name: name.trim(),
        slug: nextSlug,
        autonomous_scope: 'ops',
        description: description.trim() || undefined,
      })
      setName('')
      setSlug('')
      setDescription('')
      setShowSlug(false)
      setCreateOpen(false)
      toast.success(t('projects.page.created'))
      navigate(`/projects/${created.id}`)
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.page.createError')))
    } finally {
      setCreating(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteProject(deleteTarget.id, deleteTarget.name)
      toast.success(t('projects.page.deleted'))
      setDeleteTarget(null)
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.page.deleteError')))
    } finally {
      setDeleting(false)
    }
  }

  const visibleProjects = projects.filter((project) => {
    const needle = query.trim().toLowerCase()
    if (!needle) return true
    const hay = [project.name, project.po_agent?.name, project.description]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(needle)
  })

  return (
    <PageContent width="xl" className="space-y-4 py-1">
      <PageGuideBanner page="projects" />
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text-heading">{t('projects.page.title')}</h1>
          <p className="mt-1 text-sm text-text-muted">
            {t('projects.page.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            {t('projects.page.refresh')}
          </Button>
          {isAdmin ? (
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-4 w-4" aria-hidden />
              {t('projects.page.new')}
            </Button>
          ) : null}
        </div>
      </header>

      {error ? <ApiErrorBanner message={error} onRetry={() => void load()} /> : null}
      {!isAdmin ? (
        <p className="rounded-lg border border-border/60 bg-bg-input/40 px-3 py-2 text-xs text-text-muted">
          {t('projects.page.readonlyBanner')}
        </p>
      ) : null}
      {projects.length > 0 ? (
        <div className="relative max-w-sm">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('projects.page.searchPlaceholder')}
            aria-label={t('projects.page.searchPlaceholder')}
            className="h-9 w-full rounded-lg border border-border/60 bg-bg-surface pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent/45 focus:outline-none focus:ring-2 focus:ring-accent/15"
          />
        </div>
      ) : null}

      {loading ? (
        <LoadingBlock label={t('projects.page.loading')} />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={t('projects.page.emptyTitle')}
          description={t('projects.page.emptyBody')}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {isAdmin ? (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="mr-1 h-4 w-4" aria-hidden />
                  {t('projects.page.new')}
                </Button>
              ) : null}
              <Button size="sm" variant="outline" asChild>
                <Link to="/agents">{t('projects.page.openAgents')}</Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link to="/knowledge">{t('projects.page.openKnowledge')}</Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link to={inboxPath('open')}>{t('projects.page.openCommunication')}</Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link to="/settings/setup">{t('projects.page.openSetup')}</Link>
              </Button>
            </div>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              budget={budgets[project.id]}
              canManage={isAdmin}
              onDelete={() => setDeleteTarget(project)}
            />
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('projects.page.dialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('projects.page.dialogBody')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="project-name">{t('projects.page.name')}</Label>
              <Input
                id="project-name"
                value={name}
                autoFocus
                onChange={(e) => {
                  setName(e.target.value)
                  if (!slug || slug === slugify(name)) setSlug(slugify(e.target.value))
                }}
                placeholder={t('projects.page.namePlaceholder')}
              />
            </div>
            <button
              type="button"
              className="text-xs font-medium text-accent hover:underline"
              onClick={() => setShowSlug((open) => !open)}
            >
              {showSlug ? t('projects.page.hideAdvanced') : t('projects.page.advancedSlug')}
            </button>
            {showSlug ? (
              <div className="space-y-1.5">
                <Label htmlFor="project-slug">{t('projects.page.slug')}</Label>
                <Input
                  id="project-slug"
                  value={slug}
                  onChange={(e) => setSlug(slugify(e.target.value))}
                  placeholder={t('projects.page.slugPlaceholder')}
                />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="project-description">{t('projects.page.description')}</Label>
              <Input
                id="project-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('projects.page.descriptionPlaceholder')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              {t('projects.page.cancel')}
            </Button>
            <Button
              type="button"
              disabled={creating || !name.trim() || !(slug.trim() || slugify(name))}
              onClick={() => void create()}
            >
              {creating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus size={14} className="mr-1.5" />}
              {t('projects.page.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deleteTarget ? (
        <ConfirmDeleteDialog
          title={t('projects.page.deleteTitle')}
          itemLabel={t('projects.page.deleteItem')}
          itemName={deleteTarget.name}
          impactText={t('projects.page.deleteImpact')}
          isDeleting={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </PageContent>
  )
}
