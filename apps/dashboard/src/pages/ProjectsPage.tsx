import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import {
  Bot,
  FolderKanban,
  GitBranch,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { toast } from 'sonner'
import { PageContent } from '../components/layout/PageContent'
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
import { humanizeLabel } from '../lib/labels'

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
}: {
  project: ProjectRow
  budget: ProjectBudgetResponse | undefined
  onDelete: () => void
}) {
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
          <p className="mt-0.5 truncate text-xs text-text-muted">{project.slug}</p>
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`Actions for ${project.name}`}
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
                Open threads
              </DropdownMenu.Item>
              {project.po_agent ? (
                <DropdownMenu.Item
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-text-primary outline-none data-[highlighted]:bg-bg-hover"
                  onSelect={() => navigate(`/agents/${project.po_agent!.id}`)}
                >
                  <Bot size={14} />
                  Open orchestrator
                </DropdownMenu.Item>
              ) : null}
              <DropdownMenu.Separator className="my-1 h-px bg-border/60" />
              <DropdownMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-status-error outline-none data-[highlighted]:bg-bg-hover"
                onSelect={onDelete}
              >
                <Trash2 size={14} />
                Delete
              </DropdownMenu.Item>
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
            <span className="text-text-muted">No orchestrator</span>
          )}
        </div>
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
                  {humanizeLabel(project.repo_index_status)}
                </Badge>
              ) : null}
            </>
          ) : (
            <span className="text-text-muted">No repository</span>
          )}
        </div>
        {budget ? <ProjectBudgetBar budget={budget} /> : null}
      </div>
    </Card>
  )
}

export default function ProjectsPage() {
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
      setError(formatApiErrorMessage(err, 'Could not load projects.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const create = async () => {
    if (!name.trim() || !slug.trim()) return
    setCreating(true)
    try {
      await createProject({
        name: name.trim(),
        slug: slug.trim(),
        autonomous_scope: 'ops',
        description: description.trim() || undefined,
      })
      setName('')
      setSlug('')
      setDescription('')
      setCreateOpen(false)
      toast.success('Project created')
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not create project.'))
    } finally {
      setCreating(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteProject(deleteTarget.id, deleteTarget.name)
      toast.success('Project deleted')
      setDeleteTarget(null)
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not delete project.'))
    } finally {
      setDeleting(false)
    }
  }

  if (!isAdmin) {
    return <Navigate to={inboxPath('all')} replace />
  }

  return (
    <PageContent width="xl" className="space-y-4 py-1">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text-heading">Projects</h1>
          <p className="mt-1 text-sm text-text-muted">
            Bundle threads, agents, knowledge and code under one goal. Each project pairs an
            orchestrator with the repositories and budgets it works within.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            Refresh
          </Button>
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            New project
          </Button>
        </div>
      </header>

      {error ? <ApiErrorBanner message={error} onRetry={() => void load()} /> : null}

      {loading ? (
        <LoadingBlock label="Loading projects…" />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="A project groups threads, agents, knowledge and an optional code repository around one goal. Create your first project to give your AI workforce a shared context."
          action={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-4 w-4" aria-hidden />
              New project
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              budget={budgets[project.id]}
              onDelete={() => setDeleteTarget(project)}
            />
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Give the project a name; the URL slug is generated automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={name}
                autoFocus
                onChange={(e) => {
                  setName(e.target.value)
                  if (!slug || slug === slugify(name)) setSlug(slugify(e.target.value))
                }}
                placeholder="Operations"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-slug">Slug</Label>
              <Input
                id="project-slug"
                value={slug}
                onChange={(e) => setSlug(slugify(e.target.value))}
                placeholder="operations"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-description">Description (optional)</Label>
              <Input
                id="project-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this project about?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={creating || !name.trim() || !slug.trim()}
              onClick={() => void create()}
            >
              {creating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus size={14} className="mr-1.5" />}
              Create project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deleteTarget ? (
        <ConfirmDeleteDialog
          title="Delete project"
          itemLabel="the project"
          itemName={deleteTarget.name}
          impactText="Threads and tasks linked to this project keep their history but lose the project grouping."
          isDeleting={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </PageContent>
  )
}
