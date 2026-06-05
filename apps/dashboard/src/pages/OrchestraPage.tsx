import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { PageContent } from '../components/layout/PageContent'
import { LoadingBlock } from '../components/ui/loading-block'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { useAuth } from '../context/AuthContext'
import { RefreshCw } from 'lucide-react'
import { cn } from '../lib/utils'

type TaskItem = { id: string; name: string; schedule_kind: string; enabled: boolean }
type ProfileItem = { id: string; name: string; model: string }
type WorkstreamItem = { id: string; name: string; enabled: boolean }
type RunItem = { id: string; status: string; started_at: string }

async function orchestraFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    credentials: 'include',
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

function formatWhen(value: string) {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
}

function runStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const s = status.toLowerCase()
  if (s === 'running' || s === 'active') return 'default'
  if (s === 'failed' || s === 'error') return 'destructive'
  if (s === 'completed' || s === 'success') return 'secondary'
  return 'outline'
}

export default function OrchestraPage() {
  const { token } = useAuth()
  const [tab, setTab] = useState('tasks')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [settings, setSettings] = useState<{ orchestra_enabled: boolean; monthly_budget_cents: number } | null>(null)
  const [profiles, setProfiles] = useState<ProfileItem[]>([])
  const [workstreams, setWorkstreams] = useState<WorkstreamItem[]>([])
  const [runs, setRuns] = useState<RunItem[]>([])
  const [runningId, setRunningId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const [taskRows, settingsRow, profileRows, wsRows, runRows] = await Promise.all([
        orchestraFetch<TaskItem[]>('/api/orchestra/tasks', token),
        orchestraFetch<{ orchestra_enabled: boolean; monthly_budget_cents: number }>(
          '/api/orchestra/settings',
          token,
        ),
        orchestraFetch<ProfileItem[]>('/api/orchestra/agent-profiles', token),
        orchestraFetch<WorkstreamItem[]>('/api/orchestra/workstreams', token),
        orchestraFetch<RunItem[]>('/api/orchestra/workstream-runs', token),
      ])
      setTasks(Array.isArray(taskRows) ? taskRows : [])
      setSettings(settingsRow)
      setProfiles(Array.isArray(profileRows) ? profileRows : [])
      setWorkstreams(Array.isArray(wsRows) ? wsRows : [])
      setRuns(Array.isArray(runRows) ? runRows : [])
    } catch (err) {
      setError(formatApiErrorMessage(err, 'Could not load Orchestra.'))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const runTask = async (taskId: string) => {
    if (!token) return
    setRunningId(taskId)
    try {
      await orchestraFetch(`/api/orchestra/tasks/${taskId}/run`, token, { method: 'POST' })
      toast.success('Task started')
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not run task.'))
    } finally {
      setRunningId(null)
    }
  }

  const runWorkstream = async (workstreamId: string) => {
    if (!token) return
    setRunningId(workstreamId)
    try {
      await orchestraFetch(`/api/orchestra/workstreams/${workstreamId}/run`, token, { method: 'POST' })
      toast.success('Workstream run started')
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not run workstream.'))
    } finally {
      setRunningId(null)
    }
  }

  return (
    <PageContent width="xl" className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text-heading">Orchestra</h1>
          <p className="text-sm text-text-muted mt-1">
            Scheduled tasks, agent profiles, and workstream runs.{' '}
            <Link to="/os" className="text-accent hover:underline">
              Open AI OS canvas
            </Link>
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4 mr-1.5', loading && 'animate-spin')} aria-hidden />
          Refresh
        </Button>
      </header>

      {error ? <ApiErrorBanner message={error} onRetry={() => void load()} /> : null}

      {loading ? (
        <LoadingBlock label="Loading orchestra..." />
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex h-auto flex-wrap">
            <TabsTrigger value="tasks">Scheduled tasks</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="profiles">Agent profiles</TabsTrigger>
            <TabsTrigger value="workstreams">Workstreams</TabsTrigger>
            <TabsTrigger value="runs">Runs</TabsTrigger>
          </TabsList>

          <TabsContent value="tasks" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Scheduled tasks</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {tasks.length === 0 ? (
                  <p className="text-sm text-text-muted">
                    No scheduled tasks yet. Tasks can be created via the API or seed data.
                  </p>
                ) : (
                  tasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-0"
                    >
                      <div className="min-w-0">
                        <span className="font-medium text-text-heading">{task.name}</span>
                        <span className="ml-2 text-text-muted">{task.schedule_kind}</span>
                        {!task.enabled ? (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            disabled
                          </Badge>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={!task.enabled || runningId === task.id}
                        onClick={() => void runTask(task.id)}
                      >
                        {runningId === task.id ? 'Starting...' : 'Run now'}
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings" className="mt-4">
            <Card>
              <CardContent className="pt-6 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-muted">Orchestra enabled</span>
                  <Badge variant={settings?.orchestra_enabled ? 'default' : 'outline'}>
                    {settings?.orchestra_enabled ? 'Yes' : 'No'}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-muted">Monthly budget</span>
                  <span className="font-medium text-text-heading">
                    {new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(
                      (settings?.monthly_budget_cents ?? 0) / 100,
                    )}
                  </span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="profiles" className="mt-4">
            <Card>
              <CardContent className="pt-6 space-y-2">
                {profiles.length === 0 ? (
                  <p className="text-sm text-text-muted">
                    No agent profiles yet. Profiles define models and defaults for orchestra agents.
                  </p>
                ) : (
                  profiles.map((p) => (
                    <div
                      key={p.id}
                      className="flex justify-between gap-3 text-sm border-b border-border py-2 last:border-0"
                    >
                      <span className="font-medium text-text-heading">{p.name}</span>
                      <span className="text-text-muted truncate">{p.model}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="workstreams" className="mt-4">
            <Card>
              <CardContent className="pt-6 space-y-2">
                {workstreams.length === 0 ? (
                  <div className="space-y-2">
                    <p className="text-sm text-text-muted">No workstreams yet.</p>
                    <Button type="button" size="sm" variant="outline" asChild>
                      <Link to="/os">View AI OS canvas</Link>
                    </Button>
                  </div>
                ) : (
                  workstreams.map((w) => (
                    <div
                      key={w.id}
                      className="flex items-center justify-between gap-3 text-sm border-b border-border py-2 last:border-0"
                    >
                      <div className="min-w-0">
                        <span className="font-medium text-text-heading">{w.name}</span>
                        {!w.enabled ? (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            disabled
                          </Badge>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={!w.enabled || runningId === w.id}
                        onClick={() => void runWorkstream(w.id)}
                      >
                        {runningId === w.id ? 'Starting...' : 'Run'}
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="runs" className="mt-4">
            <Card>
              <CardContent className="pt-6 space-y-2">
                {runs.length === 0 ? (
                  <p className="text-sm text-text-muted">
                    No workstream runs yet. Run a workstream to see execution history here.
                  </p>
                ) : (
                  runs.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between gap-3 text-sm border-b border-border py-2 last:border-0"
                    >
                      <span className="text-text-muted">{formatWhen(r.started_at)}</span>
                      <Badge variant={runStatusVariant(r.status)} className="capitalize">
                        {r.status}
                      </Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </PageContent>
  )
}
