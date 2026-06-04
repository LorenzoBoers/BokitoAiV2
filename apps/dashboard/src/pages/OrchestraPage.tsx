import { useCallback, useEffect, useState } from 'react'
import { PageContent } from '../components/layout/PageContent'
import { LoadingBlock } from '../components/ui/loading-block'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { useAuth } from '../context/AuthContext'

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
    await orchestraFetch(`/api/orchestra/tasks/${taskId}/run`, token, { method: 'POST' })
    await load()
  }

  const runWorkstream = async (workstreamId: string) => {
    if (!token) return
    await orchestraFetch(`/api/orchestra/workstreams/${workstreamId}/run`, token, { method: 'POST' })
    await load()
  }

  return (
    <PageContent width="xl" className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text-heading">Orchestra</h1>
        <p className="text-sm text-text-muted mt-1">Scheduled tasks, agent profiles, and workstream runs</p>
      </header>

      {error ? <ApiErrorBanner message={error} onRetry={() => void load()} /> : null}

      {loading ? (
        <LoadingBlock label="Loading orchestra..." />
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
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
                  <p className="text-sm text-text-muted">No tasks configured yet. Create tasks via the API or seed data.</p>
                ) : (
                  tasks.map((t) => (
                    <div key={t.id} className="flex items-center justify-between border-b border-border py-2 text-sm">
                      <div>
                        <span className="font-medium">{t.name}</span>
                        <span className="ml-2 text-text-muted">{t.schedule_kind}</span>
                        {!t.enabled ? (
                          <span className="ml-2 text-xs text-text-muted">(disabled)</span>
                        ) : null}
                      </div>
                      <Button type="button" size="sm" variant="secondary" onClick={() => void runTask(t.id)}>
                        Run now
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings" className="mt-4">
            <Card>
              <CardContent className="pt-6 space-y-2 text-sm">
                <p>
                  <span className="text-text-muted">Orchestra enabled:</span>{' '}
                  {settings?.orchestra_enabled ? 'Yes' : 'No'}
                </p>
                <p>
                  <span className="text-text-muted">Monthly budget (cents):</span>{' '}
                  {settings?.monthly_budget_cents ?? 0}
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="profiles" className="mt-4">
            <Card>
              <CardContent className="pt-6 space-y-2">
                {profiles.length === 0 ? (
                  <p className="text-sm text-text-muted">No agent profiles yet.</p>
                ) : (
                  profiles.map((p) => (
                    <div key={p.id} className="flex justify-between text-sm border-b border-border py-2">
                      <span>{p.name}</span>
                      <span className="text-text-muted">{p.model}</span>
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
                  <p className="text-sm text-text-muted">No workstreams yet.</p>
                ) : (
                  workstreams.map((w) => (
                    <div key={w.id} className="flex items-center justify-between text-sm border-b border-border py-2">
                      <span>{w.name}</span>
                      <Button type="button" size="sm" variant="secondary" onClick={() => void runWorkstream(w.id)}>
                        Run
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
                  <p className="text-sm text-text-muted">No workstream runs yet.</p>
                ) : (
                  runs.map((r) => (
                    <div key={r.id} className="flex justify-between text-sm border-b border-border py-2">
                      <span className="text-text-muted">{r.started_at}</span>
                      <span>{r.status}</span>
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
