import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { LoadingBlock } from '../ui/loading-block'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { ApiErrorBanner, formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { useAuth } from '../../context/AuthContext'
import {
  deleteTrigger,
  listRuntimeProfiles,
  listTriggers,
  runTrigger,
  runWorkstreamOrchestrated,
  updateTrigger,
  type Trigger,
} from '../../lib/orchestration-api'

type ProfileItem = { id: string; name: string; model: string }
type WorkstreamItem = { id: string; name: string; enabled: boolean }
type RunItem = { id: string; status: string; started_at: string }
type RuntimeProfileItem = { id: string; name: string; model: string; role_tag: string }

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

function triggerSchedule(t: Trigger): string {
  if (t.kind === 'cron') return t.cron_expr
  if (t.kind === 'webhook') return 'on webhook'
  if (t.kind === 'once' || t.kind === 'event') {
    const at = t.next_run_at ?? t.last_run_at
    return at ? formatWhen(at) : 'unscheduled'
  }
  const minutes = t.interval_minutes || 60
  if (minutes % 1440 === 0) return `every ${minutes / 1440}d`
  if (minutes % 60 === 0) return `every ${minutes / 60}h`
  return `every ${minutes}m`
}

type AutomationsPanelProps = {
  /** Bump to force a reload (e.g. after the trigger dialog saves). */
  reloadKey?: number
  onEditTrigger?: (trigger: Trigger) => void
}

export default function AutomationsPanel({ reloadKey = 0, onEditTrigger }: AutomationsPanelProps) {
  const { token } = useAuth()
  const [tab, setTab] = useState('triggers')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [triggers, setTriggers] = useState<Trigger[]>([])
  const [settings, setSettings] = useState<{ orchestra_enabled: boolean; monthly_budget_cents: number } | null>(null)
  const [profiles, setProfiles] = useState<ProfileItem[]>([])
  const [workstreams, setWorkstreams] = useState<WorkstreamItem[]>([])
  const [runs, setRuns] = useState<RunItem[]>([])
  const [runtimeProfiles, setRuntimeProfiles] = useState<RuntimeProfileItem[]>([])
  const [runningId, setRunningId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const [triggerRows, settingsRow, profileRows, wsRows, runRows, rtProfiles] = await Promise.all([
        listTriggers().catch(() => []),
        orchestraFetch<{ orchestra_enabled: boolean; monthly_budget_cents: number }>(
          '/api/orchestra/settings',
          token,
        ),
        orchestraFetch<ProfileItem[]>('/api/orchestra/agent-profiles', token),
        orchestraFetch<WorkstreamItem[]>('/api/orchestra/workstreams', token),
        orchestraFetch<RunItem[]>('/api/orchestra/workstream-runs', token),
        listRuntimeProfiles().catch(() => []),
      ])
      setTriggers(Array.isArray(triggerRows) ? triggerRows : [])
      setSettings(settingsRow)
      setProfiles(Array.isArray(profileRows) ? profileRows : [])
      setWorkstreams(Array.isArray(wsRows) ? wsRows : [])
      setRuns(Array.isArray(runRows) ? runRows : [])
      setRuntimeProfiles(Array.isArray(rtProfiles) ? rtProfiles : [])
    } catch (err) {
      setError(formatApiErrorMessage(err, 'Could not load automations.'))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const fireTrigger = async (triggerId: string) => {
    setRunningId(triggerId)
    try {
      await runTrigger(triggerId)
      toast.success('Trigger fired')
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not run trigger.'))
    } finally {
      setRunningId(null)
    }
  }

  const toggleTrigger = async (trigger: Trigger) => {
    setRunningId(trigger.id)
    try {
      await updateTrigger(trigger.id, { enabled: !trigger.enabled })
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not update trigger.'))
    } finally {
      setRunningId(null)
    }
  }

  const removeTrigger = async (triggerId: string) => {
    setRunningId(triggerId)
    try {
      await deleteTrigger(triggerId)
      toast.success('Trigger deleted')
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not delete trigger.'))
    } finally {
      setRunningId(null)
    }
  }

  const runWorkstream = async (workstreamId: string) => {
    if (!token) return
    setRunningId(workstreamId)
    try {
      await runWorkstreamOrchestrated(workstreamId)
      toast.success('Workstream task started — track it in the inbox')
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not run workstream.'))
    } finally {
      setRunningId(null)
    }
  }

  if (loading) return <LoadingBlock label="Loading automations..." />

  return (
    <div className="space-y-4">
      {error ? <ApiErrorBanner message={error} onRetry={() => void load()} /> : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="triggers">Triggers</TabsTrigger>
          <TabsTrigger value="workstreams">Workstreams</TabsTrigger>
          <TabsTrigger value="profiles">Agent profiles</TabsTrigger>
          <TabsTrigger value="runtime">Runtime profiles</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="triggers" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>All triggers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {triggers.length === 0 ? (
                <p className="text-sm text-text-muted">
                  No triggers yet. Use New on the Agenda to schedule wakes, one-off tasks, and events.
                </p>
              ) : (
                triggers.map((trigger) => (
                  <div
                    key={trigger.id}
                    className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-0"
                  >
                    <div className="min-w-0">
                      <span className="font-medium text-text-heading">{trigger.name}</span>
                      <Badge variant="outline" className="ml-2 text-[10px] capitalize">
                        {trigger.kind}
                      </Badge>
                      <span className="ml-2 text-text-muted">{triggerSchedule(trigger)}</span>
                      {trigger.next_run_at && trigger.kind !== 'once' && trigger.kind !== 'event' ? (
                        <span className="ml-2 text-text-muted">next {formatWhen(trigger.next_run_at)}</span>
                      ) : null}
                      {trigger.last_status ? (
                        <Badge variant={runStatusVariant(trigger.last_status)} className="ml-2 text-[10px]">
                          {trigger.last_status}
                        </Badge>
                      ) : null}
                      {!trigger.enabled ? (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          disabled
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {onEditTrigger ? (
                        <Button type="button" size="sm" variant="ghost" onClick={() => onEditTrigger(trigger)}>
                          Edit
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={runningId === trigger.id}
                        onClick={() => void toggleTrigger(trigger)}
                      >
                        {trigger.enabled ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={runningId === trigger.id}
                        onClick={() => void removeTrigger(trigger.id)}
                      >
                        Delete
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={runningId === trigger.id || trigger.kind === 'webhook' || trigger.kind === 'event'}
                        onClick={() => void fireTrigger(trigger.id)}
                      >
                        {runningId === trigger.id ? 'Starting...' : 'Run now'}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="runtime" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Runtime profiles</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {runtimeProfiles.length === 0 ? (
                <p className="text-sm text-text-muted">
                  No runtime profiles yet. Profiles set the model, role, and budget per agent or workstream step.
                </p>
              ) : (
                runtimeProfiles.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 text-sm border-b border-border py-2 last:border-0"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-text-heading">{p.name}</span>
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {p.role_tag}
                      </Badge>
                    </div>
                    <span className="text-text-muted truncate">{p.model}</span>
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
                <p className="text-sm text-text-muted">No workstreams yet.</p>
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
    </div>
  )
}
