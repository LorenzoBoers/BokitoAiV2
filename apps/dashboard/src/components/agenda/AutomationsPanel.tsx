import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
import { workLogStatusLabel } from '../../lib/status-labels'
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
  const { t } = useTranslation('nav')
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
      setError(formatApiErrorMessage(err, t('agendaPage.loadAutomationsError')))
    } finally {
      setLoading(false)
    }
  }, [token, loadSteps, t])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const fireTrigger = async (triggerId: string) => {
    setRunningId(triggerId)
    try {
      const result = await runTrigger(triggerId)
      if (result.status === 'no_agent') {
        toast.error(t('agendaPage.noTarget'))
      } else if (result.status === 'agent_paused') {
        toast.error(t('agendaPage.agentPaused'))
      } else {
        toast.success(t('agendaPage.triggerFired', { status: result.status || 'ok' }))
      }
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('agendaPage.runTriggerError')))
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
      toast.error(formatApiErrorMessage(err, t('agendaPage.updateTriggerError')))
    } finally {
      setRunningId(null)
    }
  }

  const removeTrigger = async (triggerId: string) => {
    setRunningId(triggerId)
    try {
      await deleteTrigger(triggerId)
      toast.success(t('agendaPage.triggerDeleted'))
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('agendaPage.deleteTriggerError')))
    } finally {
      setRunningId(null)
    }
  }

  const runWorkstream = async (workstreamId: string) => {
    if (!token) return
    const steps = stepsByWs[workstreamId] ?? []
    if (steps.length === 0) {
      toast.error(t('agendaPage.needStep'))
      setExpandedWs(workstreamId)
      return
    }
    setRunningId(workstreamId)
    try {
      const task = await runWorkstreamOrchestrated(workstreamId)
      const threadPath = task.signal_id ? agentRunsPath('all', task.signal_id) : null
      toast.success(t('agendaPage.flowStarted'), {
        description: threadPath
          ? t('agendaPage.flowStartedThread')
          : t('agendaPage.flowStartedRuns'),
        action: threadPath
          ? {
              label: t('agendaPage.openInCommunication'),
              onClick: () => navigate(threadPath),
            }
          : undefined,
      })
      await load()
      setTab('runs')
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('agendaPage.runFlowError')))
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
          prompt_template: `Execute the "${name}" flow.`,
        })
      }
      setNewWsName('')
      toast.success(defaultAgentId ? t('agendaPage.flowCreatedStep') : t('agendaPage.flowCreated'))
      await load()
      setExpandedWs(created.id)
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('agendaPage.createFlowError')))
    } finally {
      setCreatingWs(false)
    }
  }

  const removeStep = async (workstreamId: string, stepId: string) => {
    if (!window.confirm(t('agendaPage.removeStepConfirm'))) return
    setRemovingStepId(stepId)
    try {
      await deleteWorkstreamStep(workstreamId, stepId)
      toast.success(t('agendaPage.stepRemoved'))
      await loadSteps(workstreamId)
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('agendaPage.removeStepError')))
    } finally {
      setRemovingStepId(null)
    }
  }

  const addStep = async (workstreamId: string) => {
    const name = newStepName.trim()
    if (!name) return
    if (newStepKind === 'agent' && !newStepAgentId) {
      toast.error(t('agendaPage.pickAgentStep'))
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
      toast.success(
        newStepKind === 'human_gate' ? t('agendaPage.approvalGateAdded') : t('agendaPage.stepAdded'),
      )
      await loadSteps(workstreamId)
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('agendaPage.addStepError')))
    } finally {
      setAddingStep(false)
    }
  }

  if (loading) return <LoadingBlock label={t('agendaPage.loadingAutomations')} />

  return (
    <div className="space-y-4">
      {error ? <ApiErrorBanner message={error} onRetry={() => void load()} /> : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="triggers">{t('agendaPage.triggers')}</TabsTrigger>
          <TabsTrigger value="workstreams">{t('agendaPage.workstreams')}</TabsTrigger>
          <TabsTrigger value="runtime">{t('agendaPage.runtime')}</TabsTrigger>
          <TabsTrigger value="runs">{t('agendaPage.runs')}</TabsTrigger>
        </TabsList>

        <TabsContent value="triggers" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('agendaPage.allTriggers')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {triggers.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-sm text-text-muted">
                    {t('agendaPage.noTriggers')}
                  </p>
                  <Button type="button" size="sm" variant="outline" asChild>
                    <Link to="/agenda">{t('agendaPage.backToAgenda')}</Link>
                  </Button>
                </div>
              ) : (
                triggers.map((trigger) => (
                  <div key={trigger.id} className="row-interactive rounded-lg border-b border-border px-1 py-2 last:border-0">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          aria-hidden
                          className={cn(
                            'h-2 w-2 shrink-0 rounded-full',
                            trigger.enabled
                              ? 'pulse-dot bg-status-success shadow-[0_0_6px_rgba(52,211,153,0.55)]'
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
                            {(() => {
                              const kindLabel = t(`triggerDialog.kinds.${trigger.kind}`, {
                                defaultValue: trigger.kind,
                              })
                              const name = trigger.name.trim().toLowerCase()
                              const hideKind =
                                name === kindLabel.toLowerCase() || name === String(trigger.kind).toLowerCase()
                              return hideKind
                                ? triggerSchedule(trigger)
                                : `${kindLabel} · ${triggerSchedule(trigger)}`
                            })()}
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
                          {trigger.enabled ? t('agendaPage.active') : t('agendaPage.paused')}
                        </Badge>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                        {onEditTrigger ? (
                          <Button type="button" size="sm" variant="ghost" onClick={() => onEditTrigger(trigger)}>
                            {t('agendaPage.edit')}
                          </Button>
                        ) : null}
                        <Switch
                          checked={trigger.enabled}
                          disabled={runningId === trigger.id}
                          aria-label={
                            trigger.enabled
                              ? t('agendaPage.pauseTrigger', { name: trigger.name })
                              : t('agendaPage.activateTrigger', { name: trigger.name })
                          }
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
                          {t('agendaPage.delete')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={runningId === trigger.id}
                          onClick={() => void fireTrigger(trigger.id)}
                        >
                          {runningId === trigger.id ? t('agendaPage.running') : t('agendaPage.runNow')}
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
              <CardTitle>{t('agendaPage.runtime')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-border/60">
                <input
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder={t('agendaPage.profileName')}
                  className="h-8 min-w-[10rem] flex-1 rounded-md border border-border/60 bg-bg-input/80 px-3 text-sm"
                />
                <input
                  value={newProfileModel}
                  onChange={(e) => setNewProfileModel(e.target.value)}
                  placeholder={t('agendaPage.modelOptional')}
                  className="h-8 min-w-[10rem] rounded-md border border-border/60 bg-bg-input/80 px-3 text-sm"
                />
                <select
                  value={newProfileRole}
                  onChange={(e) => setNewProfileRole(e.target.value)}
                  className="h-8 rounded-md border border-border/60 bg-bg-input/80 px-2 text-sm"
                >
                  <option value="executor">{t('agendaPage.executor')}</option>
                  <option value="orchestrator">{t('agendaPage.orchestrator')}</option>
                  <option value="evaluator">{t('agendaPage.evaluator')}</option>
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
                        toast.error(formatApiErrorMessage(err, t('agendaPage.createProfileError')))
                      } finally {
                        setCreatingProfile(false)
                      }
                    })()
                  }}
                >
                  {creatingProfile ? t('agendaPage.creating') : t('agendaPage.addProfile')}
                </Button>
              </div>
              {runtimeProfiles.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-sm text-text-muted">
                    {t('agendaPage.noProfiles')}
                  </p>
                  <Button type="button" size="sm" variant="outline" asChild>
                    <Link to="/agents">{t('agendaPage.openAgents')}</Link>
                  </Button>
                </div>
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
              <CardTitle>{t('agendaPage.workstreams')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={newWsName}
                  onChange={(e) => setNewWsName(e.target.value)}
                  placeholder={t('agendaPage.newWorkstream')}
                  className="h-8 min-w-[12rem] flex-1 rounded-md border border-border/60 bg-bg-input/80 px-3 text-sm"
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
                  {creatingWs ? t('agendaPage.creating') : t('agendaPage.create')}
                </Button>
              </div>
              {workstreams.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-sm text-text-muted">
                    {t('agendaPage.noWorkstreams')}
                  </p>
                  <Button type="button" size="sm" variant="outline" asChild>
                    <Link to="/projects">{t('agendaPage.openProjects')}</Link>
                  </Button>
                </div>
              ) : (
                workstreams.map((w) => {
                  const steps = stepsByWs[w.id] ?? []
                  const open = expandedWs === w.id
                  return (
                    <div key={w.id} className="rounded-lg border border-border/60">
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
                            {t('agendaPage.steps', { count: steps.length })}
                          </Badge>
                          {!w.enabled ? (
                            <Badge variant="outline" className="shrink-0 border-border text-[10px] text-text-muted">
                              {t('agendaPage.paused')}
                            </Badge>
                          ) : null}
                        </button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={!w.enabled || runningId === w.id || steps.length === 0}
                          title={steps.length === 0 ? t('agendaPage.addStepFirst') : undefined}
                          onClick={() => void runWorkstream(w.id)}
                        >
                          {runningId === w.id ? t('agendaPage.starting') : t('agendaPage.run')}
                        </Button>
                      </div>
                      {open ? (
                        <div className="space-y-2 border-t border-border/60 bg-bg-muted/20 px-3 py-3">
                          {steps.length === 0 ? (
                            <p className="text-xs text-text-muted">
                              {t('agendaPage.noSteps')}
                            </p>
                          ) : (
                            <ol className="space-y-1">
                              {steps.map((step, index) => {
                                const isGate = step.step_kind === 'human_gate'
                                const agentName =
                                  agents.find((a) => a.id === step.agent_id)?.name ??
                                  (step.agent_id ? t('agendaPage.agent') : t('agendaPage.noAgentsOption'))
                                return (
                                  <li
                                    key={step.id}
                                    className="flex items-center gap-2 text-xs text-text-secondary"
                                  >
                                    <span className="w-5 tabular-nums text-text-muted">{index + 1}.</span>
                                    <span className="font-medium text-text-heading">{step.name}</span>
                                    <span className="min-w-0 flex-1 truncate text-text-muted">
                                      · {isGate ? t('agendaPage.approvalGate') : agentName}
                                    </span>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 shrink-0 p-0"
                                      disabled={removingStepId === step.id}
                                      aria-label={t('agendaPage.removeStepAria', { name: step.name })}
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
                              placeholder={t('agendaPage.stepName')}
                              className="h-8 min-w-[8rem] flex-1 rounded-md border border-border/60 bg-bg-input/80 px-2 text-xs"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void addStep(w.id)
                              }}
                            />
                            <select
                              value={newStepKind}
                              onChange={(e) =>
                                setNewStepKind(e.target.value === 'human_gate' ? 'human_gate' : 'agent')
                              }
                              className="h-8 rounded-md border border-border/60 bg-bg-input/80 px-2 text-xs"
                            >
                              <option value="agent">{t('agendaPage.agent')}</option>
                              <option value="human_gate">{t('agendaPage.approvalGate')}</option>
                            </select>
                            {newStepKind === 'agent' ? (
                              <select
                                value={newStepAgentId}
                                onChange={(e) => setNewStepAgentId(e.target.value)}
                                className="h-8 rounded-md border border-border/60 bg-bg-input/80 px-2 text-xs"
                              >
                                {agents.length === 0 ? (
                                  <option value="">{t('agendaPage.noAgentsOption')}</option>
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
                              {addingStep ? t('agendaPage.adding') : t('agendaPage.addStep')}
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
                <div className="space-y-2">
                  <p className="text-sm text-text-muted">
                    {t('agendaPage.noRuns')}
                  </p>
                  <Button type="button" size="sm" variant="outline" asChild>
                    <Link to="/agents">{t('agendaPage.openAgents')}</Link>
                  </Button>
                </div>
              ) : (
                tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between gap-3 text-sm border-b border-border py-2 last:border-0"
                  >
                    <div className="min-w-0">
                      <span className="font-medium text-text-heading truncate">{task.title}</span>
                      {task.created_at ? (
                        <span className="ml-2 text-text-muted">{formatWhen(task.created_at)}</span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {task.signal_id ? (
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={agentRunsPath('all', task.signal_id)}>{t('agendaPage.openRun')}</Link>
                        </Button>
                      ) : null}
                      <Badge variant={runStatusVariant(task.status)} className="capitalize">
                        {workLogStatusLabel(task.status, t)}
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
