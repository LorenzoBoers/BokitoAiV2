import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy, GitBranch, Loader2, Plus, RefreshCw, Trash2, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import { PageContent } from '../components/layout/PageContent'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import ConfirmDeleteDialog from '../components/ui/ConfirmDeleteDialog'
import { listAgents } from '../lib/agents-api'
import {
  connectProjectRepo,
  createProject,
  createProjectPoAgent,
  deleteProject,
  disconnectProjectRepo,
  getProjectBudget,
  linkProjectPoAgentById,
  listProjects,
  reindexProjectRepo,
  type ProjectBudgetResponse,
  type ProjectRow,
} from '../lib/projects-api'

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function copyText(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(`${label} copied`)
  } catch {
    toast.error(`Could not copy ${label.toLowerCase()}`)
  }
}

function ProjectRepoSection({ project, onChanged }: { project: ProjectRow; onChanged: () => Promise<void> }) {
  const [repoName, setRepoName] = useState('')
  const [branch, setBranch] = useState('main')
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<unknown>, successMessage: string, failMessage: string) => {
    setBusy(true)
    try {
      await action()
      toast.success(successMessage)
      await onChanged()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, failMessage))
    } finally {
      setBusy(false)
    }
  }

  if (!project.github_repo_full_name) {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs text-text-muted">Repository</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            className="flex-1 min-w-[180px]"
            value={repoName}
            onChange={(e) => setRepoName(e.target.value)}
            placeholder="owner/repo"
          />
          <Input
            className="w-28"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="main"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !repoName.trim().includes('/')}
            onClick={() =>
              void run(
                () =>
                  connectProjectRepo(project.id, {
                    github_repo_full_name: repoName.trim(),
                    github_default_branch: branch.trim() || 'main',
                  }),
                'Repository connected',
                'Could not connect repository.',
              )
            }
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitBranch size={14} className="mr-1" />}
            Connect
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-text-muted">Repository</Label>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded border border-border/60 bg-bg-base px-2 py-1 text-xs">
          {project.github_repo_full_name}
        </code>
        <Badge variant="outline">{project.github_default_branch || 'main'}</Badge>
        {project.repo_index_status ? (
          <Badge variant={project.repo_index_status === 'error' ? 'destructive' : 'secondary'}>
            {project.repo_index_status}
          </Badge>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void run(() => reindexProjectRepo(project.id), 'Reindex queued', 'Could not queue reindex.')
          }
        >
          <RefreshCw size={13} className="mr-1" />
          Reindex
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void run(() => disconnectProjectRepo(project.id), 'Repository disconnected', 'Could not disconnect repository.')
          }
        >
          <Unplug size={13} className="mr-1" />
          Disconnect
        </Button>
      </div>
      {project.repo_index_error ? (
        <p className="text-xs text-status-error">{project.repo_index_error}</p>
      ) : null}
    </div>
  )
}

export default function ProjectsSettings() {
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [scope, setScope] = useState('ops')
  const [linkingProjectId, setLinkingProjectId] = useState<string | null>(null)
  const [budgets, setBudgets] = useState<Record<string, ProjectBudgetResponse>>({})
  const [deleteTarget, setDeleteTarget] = useState<ProjectRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [projectRows, agentRows] = await Promise.all([listProjects(), listAgents()])
      setProjects(projectRows)
      setAgents(agentRows.map((a) => ({ id: a.id, name: a.name })))
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
        autonomous_scope: scope.trim() || 'ops',
      })
      setName('')
      setSlug('')
      toast.success('Project created')
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not create project.'))
    } finally {
      setCreating(false)
    }
  }

  const linkOrchestrator = async (projectId: string, agentId: string) => {
    setLinkingProjectId(projectId)
    try {
      if (agentId === '__create__') {
        await createProjectPoAgent(projectId, 'Project Orchestrator')
      } else {
        await linkProjectPoAgentById(projectId, agentId)
      }
      toast.success('Orchestrator linked')
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not link orchestrator.'))
    } finally {
      setLinkingProjectId(null)
    }
  }

  return (
    <PageContent>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-text-heading">Projects</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Group threads and orchestration under a project. Link an orchestrator agent for routing and context.
          </p>
        </div>

        {error ? <ApiErrorBanner message={error} onRetry={() => void load()} /> : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">New project</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="project-name">Name</Label>
                <Input
                  id="project-name"
                  value={name}
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
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-scope">Autonomous scope</Label>
              <Input
                id="project-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                placeholder="ops"
              />
            </div>
            <Button type="button" disabled={creating || !name.trim() || !slug.trim()} onClick={() => void create()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Plus size={14} className="mr-1.5" />}
              Create project
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Projects</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-text-muted py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </div>
            ) : projects.length === 0 ? (
              <p className="text-sm text-text-muted py-4">No projects yet.</p>
            ) : (
              projects.map((project) => (
                <div key={project.id} className="rounded-lg border border-border/70 p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-text-heading">{project.name}</p>
                      <p className="text-xs text-text-muted mt-0.5">{project.slug}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{project.autonomous_scope}</Badge>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-status-error hover:text-status-error"
                        aria-label={`Delete ${project.name}`}
                        onClick={() => setDeleteTarget(project)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>

                  {budgets[project.id] ? (
                    <p className="text-xs text-text-muted">
                      Tokens today: {budgets[project.id].token_used_today.toLocaleString()} /{' '}
                      {budgets[project.id].token_budget_daily.toLocaleString()}
                      {budgets[project.id].blocked ? (
                        <span className="ml-2 text-status-error">Budget exhausted</span>
                      ) : null}
                    </p>
                  ) : null}

                  <div className="space-y-1">
                    <Label className="text-xs text-text-muted">Project ID</Label>
                    <div className="flex gap-2">
                      <code className="flex-1 truncate rounded border border-border/60 bg-bg-base px-2 py-1 text-xs">
                        {project.id}
                      </code>
                      <Button type="button" size="sm" variant="outline" onClick={() => void copyText(project.id, 'Project ID')}>
                        <Copy size={14} />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-text-muted">Orchestrator agent</Label>
                    {project.po_agent ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Link to={`/agents/${project.po_agent.id}`} className="text-sm text-accent hover:underline">
                          {project.po_agent.name}
                        </Link>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void copyText(project.po_agent!.id, 'Orchestrator ID')}
                        >
                          <Copy size={14} className="mr-1" />
                          Copy ID
                        </Button>
                      </div>
                    ) : (
                      <Select
                        disabled={linkingProjectId === project.id}
                        onValueChange={(value) => void linkOrchestrator(project.id, value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Link orchestrator" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__create__">Create new orchestrator</SelectItem>
                          {agents.map((agent) => (
                            <SelectItem key={agent.id} value={agent.id}>
                              {agent.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <ProjectRepoSection project={project} onChanged={load} />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

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
