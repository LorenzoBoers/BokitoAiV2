import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { PageContent } from '../components/layout/PageContent'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { listAgents } from '../lib/agents-api'
import {
  createProject,
  createProjectPoAgent,
  linkProjectPoAgentById,
  listProjects,
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

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [projectRows, agentRows] = await Promise.all([listProjects(), listAgents()])
      setProjects(projectRows)
      setAgents(agentRows.map((a) => ({ id: a.id, name: a.name })))
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
                    <Badge variant="outline">{project.autonomous_scope}</Badge>
                  </div>

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
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </PageContent>
  )
}
