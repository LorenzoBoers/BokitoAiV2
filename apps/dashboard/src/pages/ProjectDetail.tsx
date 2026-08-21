import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Bot,
  Copy,
  GitBranch,
  Loader2,
  MessageSquare,
  Trash2,
  Wallet,
  Workflow,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageContent } from '../components/layout/PageContent'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import ConfirmDeleteDialog from '../components/ui/ConfirmDeleteDialog'
import { LoadingBlock } from '../components/ui/loading-block'
import { ProjectBudgetBar } from '../components/projects/ProjectBudgetBar'
import { ProjectOrchestratorSection } from '../components/projects/ProjectOrchestratorSection'
import { ProjectRepoSection } from '../components/projects/ProjectRepoSection'
import { WorkLogsTable } from '../components/workforce/WorkLogsTable'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { listAgents } from '../lib/agents-api'
import { humanizeLabel } from '../lib/labels'
import { inboxPath } from '../lib/messages-paths'
import {
  deleteProject,
  getProject,
  getProjectBudget,
  patchProject,
  type ProjectBudgetResponse,
  type ProjectRow,
} from '../lib/projects-api'
import { listWorkLogs, type WorkLogRow } from '../lib/work-logs-api'
import { workLogDetailUrl } from '../lib/workforce-run-urls'
import { listProjectWorkstreams, type ProjectWorkstreamRow } from '../lib/workstreams-api'

const WORKSTREAM_STATUS_VARIANT: Record<string, 'secondary' | 'outline'> = {
  active: 'secondary',
  draft: 'outline',
  paused: 'outline',
}

async function copyText(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(`${label} copied`)
  } catch {
    toast.error(`Could not copy ${label.toLowerCase()}`)
  }
}

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()

  const [project, setProject] = useState<ProjectRow | null>(null)
  const [budget, setBudget] = useState<ProjectBudgetResponse | null>(null)
  const [workstreams, setWorkstreams] = useState<ProjectWorkstreamRow[]>([])
  const [runs, setRuns] = useState<WorkLogRow[]>([])
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const row = await getProject(projectId)
      setProject(row)
      setName(row.name)
      setDescription(row.description ?? '')
      // Secondary data may fail independently without blocking the page.
      const [budgetResult, streamsResult, runsResult, agentsResult] = await Promise.allSettled([
        getProjectBudget(projectId),
        listProjectWorkstreams(projectId),
        listWorkLogs({ project_id: projectId, limit: 10 }),
        listAgents(),
      ])
      setBudget(budgetResult.status === 'fulfilled' ? budgetResult.value : null)
      setWorkstreams(streamsResult.status === 'fulfilled' ? streamsResult.value.items : [])
      setRuns(runsResult.status === 'fulfilled' ? runsResult.value : [])
      setAgents(
        agentsResult.status === 'fulfilled'
          ? agentsResult.value.map((a) => ({ id: a.id, name: a.name }))
          : [],
      )
    } catch (err) {
      setError(formatApiErrorMessage(err, 'Could not load project.'))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = useMemo(() => {
    if (!project) return false
    return name.trim() !== project.name || description.trim() !== (project.description ?? '')
  }, [project, name, description])

  const saveAbout = async () => {
    if (!project || !name.trim()) return
    setSaving(true)
    try {
      const updated = await patchProject(project.id, {
        name: name.trim(),
        description: description.trim() || undefined,
      })
      setProject(updated)
      setName(updated.name)
      setDescription(updated.description ?? '')
      toast.success('Project saved')
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not save project.'))
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!project) return
    setDeleting(true)
    try {
      await deleteProject(project.id, project.name)
      toast.success('Project deleted')
      navigate('/projects')
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not delete project.'))
    } finally {
      setDeleting(false)
    }
  }

  if (!isAdmin) {
    return <Navigate to={inboxPath('all')} replace />
  }

  const threadsHref = project
    ? `${inboxPath('all')}?project_id=${encodeURIComponent(project.id)}`
    : inboxPath('all')

  return (
    <PageContent width="xl" className="space-y-4 py-1">
      <Link
        to="/projects"
        className="inline-flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-text-primary"
      >
        <ArrowLeft size={14} />
        Back to projects
      </Link>

      {loading ? (
        <LoadingBlock label="Loading project…" />
      ) : error || !project ? (
        <ApiErrorBanner message={error ?? 'Project not found.'} onRetry={() => void load()} />
      ) : (
        <>
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold text-text-heading">{project.name}</h1>
                <Badge variant="outline">{project.slug}</Badge>
              </div>
              {project.description ? (
                <p className="mt-1 max-w-2xl text-sm text-text-muted">{project.description}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button asChild type="button" size="sm" variant="outline">
                <Link to={threadsHref}>
                  <MessageSquare size={14} className="mr-1" />
                  View threads
                </Link>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-status-error hover:text-status-error"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 size={14} className="mr-1" />
                Delete
              </Button>
            </div>
          </header>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bot size={16} className="text-text-muted" />
                  Orchestration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ProjectOrchestratorSection project={project} agents={agents} onChanged={load} />
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs text-text-muted">
                    <Workflow size={12} />
                    Workstreams
                  </Label>
                  {workstreams.length === 0 ? (
                    <p className="text-sm text-text-muted">No workstreams configured yet.</p>
                  ) : (
                    <ul className="space-y-1">
                      {workstreams.map((stream) => (
                        <li
                          key={stream.id}
                          className="flex items-center justify-between gap-2 rounded-md border border-border/50 px-2.5 py-1.5"
                        >
                          <span className="truncate text-sm text-text-primary">{stream.name}</span>
                          <Badge
                            variant={WORKSTREAM_STATUS_VARIANT[stream.status] ?? 'outline'}
                            className="px-1.5 py-0 text-[10px]"
                          >
                            {humanizeLabel(stream.status)}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitBranch size={16} className="text-text-muted" />
                  Repository
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ProjectRepoSection project={project} onChanged={load} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wallet size={16} className="text-text-muted" />
                  Budget
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {budget ? (
                  <>
                    <ProjectBudgetBar budget={budget} />
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-text-muted">Remaining today</p>
                        <p className="font-medium text-text-heading">
                          {budget.remaining_today.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-text-muted">Remaining this hour</p>
                        <p className="font-medium text-text-heading">
                          {budget.remaining_hour.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-text-muted">No budget data available.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">About this project</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="project-name">Name</Label>
                  <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="project-description">Description for your AI team</Label>
                  <Input
                    id="project-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What is this project about?"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => void copyText(project.id, 'Project ID')}
                    className="inline-flex items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-text-primary"
                    title={project.id}
                  >
                    <Copy size={12} />
                    Copy project ID
                  </button>
                  <Button type="button" size="sm" disabled={!dirty || saving || !name.trim()} onClick={() => void saveAbout()}>
                    {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                    Save changes
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-text-heading">Recent activity</h2>
              <Button asChild type="button" size="sm" variant="ghost">
                <Link to={threadsHref}>Open project threads</Link>
              </Button>
            </div>
            {runs.length === 0 ? (
              <Card className="p-4">
                <p className="text-sm text-text-muted">No agent runs for this project yet.</p>
              </Card>
            ) : (
              <WorkLogsTable
                runs={runs}
                projects={[project]}
                runTo={workLogDetailUrl}
                showProjectColumn={false}
              />
            )}
          </section>
        </>
      )}

      {deleteOpen && project ? (
        <ConfirmDeleteDialog
          title="Delete project"
          itemLabel="the project"
          itemName={project.name}
          impactText="Threads and tasks linked to this project keep their history but lose the project grouping. Agents are unlinked but not deleted."
          isDeleting={deleting}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </PageContent>
  )
}
