import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { LoadingBlock } from '../ui/loading-block'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { Switch } from '../ui/switch'
import { ApiErrorBanner, formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { cn } from '../../lib/utils'
import { useAuth } from '../../context/AuthContext'
import { listAgents } from '../../lib/agents-api'
import { agentRunsPath } from '../../lib/messages-paths'
import {
  createRuntimeProfile,
  createWorkstream,
  createWorkstreamStep,
  deleteWorkstreamStep,
  deleteTrigger,
  listAgentTasks,
  listRuntimeProfiles,
  listTriggers,
  listWorkstreamSteps,
  listWorkstreams,
  runTrigger,
  runWorkstreamOrchestrated,
  updateTrigger,
  type AgentTask,
  type Trigger,
  type Workstream,
  type WorkstreamStep,
} from '../../lib/orchestration-api'
import { WebhookTriggerPanel } from './WebhookTriggerPanel'

type RuntimeProfileItem = { id: string; name: string; model: string; role_tag: string }
type AgentOption = { id: string; name: string }

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
  const navigate = useNavigate()
  const [tab, setTab] = useState('triggers')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [triggers, setTriggers] = useState<Trigger[]>([])
  const [workstreams, setWorkstreams] = useState<Workstream[]>([])
  const [tasks, setTasks] = useState<AgentTask[]>([])
  const [runtimeProfiles, setRuntimeProfiles] = useState<RuntimeProfileItem[]>([])
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [stepsByWs, setStepsByWs] = useState<Record<string, WorkstreamStep[]>>({})
  const [expandedWs, setExpandedWs] = useState<string | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [newWsName, setNewWsName] = useState('')
  const [creatingWs, setCreatingWs] = useState(false)
  const [newStepName, setNewStepName] = useState('')
  const [newStepAgentId, setNewStepAgentId] = useState('')
  const [newStepKind, setNewStepKind] = useState<'agent' | 'human_gate'>('agent')
  const [addingStep, setAddingStep] = useState(false)
  const [removingStepId, setRemovingStepId] = useState<string | null>(null)
  const [newProfileName, setNewProfileName] = useState('')
  const [newProfileModel, setNewProfileModel] = useState('')
  const [newProfileRole, setNewProfileRole] = useState('executor')
  const [creatingProfile, setCreatingProfile] = useState(false)

  const loadSteps = useCallback(async (workstreamId: string) => {
    try {
      const steps = await listWorkstreamSteps(workstreamId)
      setStepsByWs((prev) => ({ ...prev, [workstreamId]: steps }))
    } catch {
      setStepsByWs((prev) => ({ ...prev, [workstreamId]: [] }))
    }
  }, [])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const [triggerRows, wsRows, taskRows, rtProfiles, agentRows] = await Promise.all([
        listTriggers().catch(() => []),
        listWorkstreams(),
        listAgentTasks().catch(() => []),
        listRuntimeProfiles().catch(() => []),
        listAgents().catch(() => []),
      ])
      setTriggers(Array.isArray(triggerRows) ? triggerRows : [])
      const wsList = Array.isArray(wsRows) ? wsRows : []
      setWorkstreams(wsList)
      setTasks(Array.isArray(taskRows) ? taskRows : [])
      setRuntimeProfiles(Array.isArray(rtProfiles) ? rtProfiles : [])
      const agentOpts = (Array.isArray(agentRows) ? agentRows : []).map((a) => ({
        id: a.id,
        name: a.name,
      }))
      setAgents(agentOpts)
      setNewStepAgentId((prev) => prev || agentOpts[0]?.id || '')
      await Promise.all(wsList.map((w) => loadSteps(w.id)))
    } catch (err) {
      setError(formatApiErrorMessage(err, 'Could not load automations.'))
    } finally {
      setLoading(false)
    }
  }, [token, loadSteps])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const fireTrigger = async (triggerId: string) => {
    setRunningId(triggerId)
    try {
      const result = await runTrigger(triggerId)
      if (result.status === 'no_agent') {
        toast.error('Trigger has no agent or workstream target — edit it and pick one.')
      } else {
        toast.success(`Trigger fired (${result.status || 'ok'})`)
      }
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
    const steps = stepsByWs[workstreamId] ?? []
    if (steps.length === 0) {
      toast.error('Add at least one step before running this workstream.')
      setExpandedWs(workstreamId)
      return
    }
    setRunningId(workstreamId)
    try {
      const task = await runWorkstreamOrchestrated(workstreamId)
      const threadPath = task.signal_id ? agentRunsPath('all', task.signal_id) : null
      toast.success('Workstream started', {
        description: threadPath
          ? 'Open the run thread in Messages to follow progress and decisions.'
          : 'Track progress under Runs.',
        action: threadPath
          ? {
              label: 'Open in Messages',
              onClick: () => navigate(threadPath),
            }
          : undefined,
      })
      await load()
      setTab('runs')
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not run workstream.'))
    } finally {
      setRunningId(null)
    }
  }

  const addWorkstream = async () => {
    const name = newWsName.trim()
    if (!name) return
    setCreatingWs(true)
    try {
      const created = await createWorkstream({ name })
      const defaultAgentId = agents[0]?.id
      if (defaultAgentId) {
        await createWorkstreamStep(created.id, {
          name: 'Step 1',
          order: 0,
          agent_id: defaultAgentId,
          prompt_template: `Execute the "${name}" workstream.`,
        })
      }
      setNewWsName('')
      toast.success(defaultAgentId ? 'Workstream created with a first step' : 'Workstream created — add a step to run it')
      await load()
      setExpandedWs(created.id)
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not create workstream.'))
    } finally {
      setCreatingWs(false)
    }
  }

  const removeStep = async (workstreamId: string, stepId: string) => {
    if (!window.confirm('Remove this step from the workstream?')) return
    setRemovingStepId(stepId)
    try {
      await deleteWorkstreamStep(workstreamId, stepId)
      toast.success('Step removed')
      await loadSteps(workstreamId)
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not remove step.'))
    } finally {
      setRemovingStepId(null)
    }
  }

  const addStep = async (workstreamId: string) => {
    const name = newStepName.trim()
    if (!name) return
    if (newStepKind === 'agent' && !newStepAgentId) {
      toast.error('Pick an agent for this step.')
      return
    }
    setAddingStep(true)
    try {
      const existing = stepsByWs[workstreamId] ?? []
      await createWorkstreamStep(workstreamId, {
        name,
        order: existing.length,
        step_kind: newStepKind,
        agent_id: newStepKind === 'agent' ? newStepAgentId : undefined,
        prompt_template:
          newStepKind === 'human_gate'
            ? `Approve before continuing past "${name}".`
            : `Execute step "${name}".`,
      })
      setNewStepName('')
      setNewStepKind('agent')
      toast.success(newStepKind === 'human_gate' ? 'Approval gate added' : 'Step added')
      await loadSteps(workstreamId)
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not add step.'))
    } finally {
      setAddingStep(false)
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
          <TabsTrigger value="runtime">Runtime profiles</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
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
                  <div key={trigger.id} className="border-b border-border py-2 last:border-0">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          aria-hidden
                          className={cn(
                            'h-2 w-2 shrink-0 rounded-full',
                            trigger.enabled
                              ? 'bg-status-success shadow-[0_0_6px_rgba(52,211,153,0.55)]'
                              : 'border border-border bg-transparent',
                          )}
                        />
                        <div className={cn('min-w-0', !trigger.enabled && 'opacity-55')}>
                          <span
                            className={cn(
                              'font-medium',
                              trigger.enabled ? 'text-text-heading' : 'text-text-muted',
                            )}
                          >
                            {trigger.name}
                          </span>
                          <span className="ml-2 text-text-muted">
                            {trigger.kind} · {triggerSchedule(trigger)}
                          </span>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn(
                            'shrink-0 text-[10px]',
                            trigger.enabled
                              ? 'border-status-success/40 text-status-success'
                              : 'border-border text-text-muted',
                          )}
                        >
                          {trigger.enabled ? 'Active' : 'Paused'}
                        </Badge>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                        {onEditTrigger ? (
                          <Button type="button" size="sm" variant="ghost" onClick={() => onEditTrigger(trigger)}>
                            Edit
                          </Button>
                        ) : null}
                        <Switch
                          checked={trigger.enabled}
                          disabled={runningId === trigger.id}
                          aria-label={trigger.enabled ? `Pause ${trigger.name}` : `Activate ${trigger.name}`}
                          onCheckedChange={() => void toggleTrigger(trigger)}
                          className="h-5 w-9 [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-[16px]"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-status-error"
                          disabled={runningId === trigger.id}
                          onClick={() => void removeTrigger(trigger.id)}
                        >
                          Delete
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={runningId === trigger.id}
                          onClick={() => void fireTrigger(trigger.id)}
                        >
                          {runningId === trigger.id ? 'Running...' : 'Run now'}
                        </Button>
                      </div>
                    </div>
                    {trigger.kind === 'webhook' ? (
                      <div className="mt-2">
                        <WebhookTriggerPanel trigger={trigger} compact onUpdated={() => void load()} />
                      </div>
                    ) : null}
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
              <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-border/60">
                <input
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="Profile name"
                  className="h-8 min-w-[10rem] flex-1 rounded-md border border-border/70 bg-bg-input/80 px-3 text-sm"
                />
                <input
                  value={newProfileModel}
                  onChange={(e) => setNewProfileModel(e.target.value)}
                  placeholder="Model (optional)"
                  className="h-8 min-w-[10rem] rounded-md border border-border/70 bg-bg-input/80 px-3 text-sm"
                />
                <select
                  value={newProfileRole}
                  onChange={(e) => setNewProfileRole(e.target.value)}
                  className="h-8 rounded-md border border-border/70 bg-bg-input/80 px-2 text-sm"
                >
                  <option value="executor">Executor</option>
                  <option value="orchestrator">Orchestrator</option>
                  <option value="evaluator">Evaluator</option>
                </select>
                <Button
                  type="button"
                  size="sm"
                  disabled={creatingProfile || !newProfileName.trim()}
                  onClick={() => {
                    void (async () => {
                      setCreatingProfile(true)
                      try {
                        await createRuntimeProfile({
                          name: newProfileName.trim(),
                          role_tag: newProfileRole,
                          ...(newProfileModel.trim() ? { model: newProfileModel.trim() } : {}),
                        })
                        setNewProfileName('')
                        setNewProfileModel('')
                        toast.success('Runtime profile created')
                        await load()
                      } catch (err) {
                        toast.error(formatApiErrorMessage(err, 'Could not create runtime profile.'))
                      } finally {
                        setCreatingProfile(false)
                      }
                    })()
                  }}
                >
                  {creatingProfile ? 'Creating...' : 'Add profile'}
                </Button>
              </div>
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

        <TabsContent value="workstreams" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Workstreams</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={newWsName}
                  onChange={(e) => setNewWsName(e.target.value)}
                  placeholder="New workstream name"
                  className="h-8 min-w-[12rem] flex-1 rounded-md border border-border/70 bg-bg-input/80 px-3 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void addWorkstream()
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={creatingWs || !newWsName.trim()}
                  onClick={() => void addWorkstream()}
                >
                  {creatingWs ? 'Creating...' : 'Create'}
                </Button>
              </div>
              {workstreams.length === 0 ? (
                <p className="text-sm text-text-muted">
                  No workstreams yet. Create one to group multi-step agent runs.
                </p>
              ) : (
                workstreams.map((w) => {
                  const steps = stepsByWs[w.id] ?? []
                  const open = expandedWs === w.id
                  return (
                    <div key={w.id} className="rounded-lg border border-border/70">
                      <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                          onClick={() => setExpandedWs(open ? null : w.id)}
                        >
                          {open ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                          )}
                          <span
                            className={cn(
                              'truncate font-medium',
                              w.enabled ? 'text-text-heading' : 'text-text-muted opacity-70',
                            )}
                          >
                            {w.name}
                          </span>
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            {steps.length} step{steps.length === 1 ? '' : 's'}
                          </Badge>
                          {!w.enabled ? (
                            <Badge variant="outline" className="shrink-0 border-border text-[10px] text-text-muted">
                              Paused
                            </Badge>
                          ) : null}
                        </button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={!w.enabled || runningId === w.id || steps.length === 0}
                          title={steps.length === 0 ? 'Add a step first' : undefined}
                          onClick={() => void runWorkstream(w.id)}
                        >
                          {runningId === w.id ? 'Starting...' : 'Run'}
                        </Button>
                      </div>
                      {open ? (
                        <div className="space-y-2 border-t border-border/60 bg-bg-muted/20 px-3 py-3">
                          {steps.length === 0 ? (
                            <p className="text-xs text-text-muted">
                              No steps yet. Add an agent step or an approval gate so Run has something to execute.
                            </p>
                          ) : (
                            <ol className="space-y-1">
                              {steps.map((step, index) => {
                                const isGate = step.step_kind === 'human_gate'
                                const agentName =
                                  agents.find((a) => a.id === step.agent_id)?.name ??
                                  (step.agent_id ? 'Agent' : 'No agent')
                                return (
                                  <li
                                    key={step.id}
                                    className="flex items-center gap-2 text-xs text-text-secondary"
                                  >
                                    <span className="w-5 tabular-nums text-text-muted">{index + 1}.</span>
                                    <span className="font-medium text-text-heading">{step.name}</span>
                                    <span className="min-w-0 flex-1 truncate text-text-muted">
                                      · {isGate ? 'Approval gate' : agentName}
                                    </span>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 shrink-0 p-0"
                                      disabled={removingStepId === step.id}
                                      aria-label={`Remove step ${step.name}`}
                                      onClick={() => void removeStep(w.id, step.id)}
                                    >
                                      <Trash2 size={12} />
                                    </Button>
                                  </li>
                                )
                              })}
                            </ol>
                          )}
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <input
                              value={newStepName}
                              onChange={(e) => setNewStepName(e.target.value)}
                              placeholder="Step name"
                              className="h-8 min-w-[8rem] flex-1 rounded-md border border-border/70 bg-bg-input/80 px-2 text-xs"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void addStep(w.id)
                              }}
                            />
                            <select
                              value={newStepKind}
                              onChange={(e) =>
                                setNewStepKind(e.target.value === 'human_gate' ? 'human_gate' : 'agent')
                              }
                              className="h-8 rounded-md border border-border/70 bg-bg-input/80 px-2 text-xs"
                            >
                              <option value="agent">Agent</option>
                              <option value="human_gate">Approval gate</option>
                            </select>
                            {newStepKind === 'agent' ? (
                              <select
                                value={newStepAgentId}
                                onChange={(e) => setNewStepAgentId(e.target.value)}
                                className="h-8 rounded-md border border-border/70 bg-bg-input/80 px-2 text-xs"
                              >
                                {agents.length === 0 ? (
                                  <option value="">No agents</option>
                                ) : (
                                  agents.map((a) => (
                                    <option key={a.id} value={a.id}>
                                      {a.name}
                                    </option>
                                  ))
                                )}
                              </select>
                            ) : null}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={
                                addingStep ||
                                !newStepName.trim() ||
                                (newStepKind === 'agent' && !newStepAgentId)
                              }
                              onClick={() => void addStep(w.id)}
                            >
                              {addingStep ? 'Adding...' : 'Add step'}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="runs" className="mt-4">
          <Card>
            <CardContent className="pt-6 space-y-2">
              {tasks.length === 0 ? (
                <p className="text-sm text-text-muted">
                  No task runs yet. Run a workstream or trigger to see execution history here.
                </p>
              ) : (
                tasks.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-3 text-sm border-b border-border py-2 last:border-0"
                  >
                    <div className="min-w-0">
                      <span className="font-medium text-text-heading truncate">{t.title}</span>
                      {t.created_at ? (
                        <span className="ml-2 text-text-muted">{formatWhen(t.created_at)}</span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {t.signal_id ? (
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={agentRunsPath('all', t.signal_id)}>Open</Link>
                        </Button>
                      ) : null}
                      <Badge variant={runStatusVariant(t.status)} className="capitalize">
                        {t.status}
                      </Badge>
                    </div>
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
