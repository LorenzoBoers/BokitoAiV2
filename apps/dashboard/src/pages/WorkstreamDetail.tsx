import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Loader2,
  Play,
  Plus,
  Trash2,
} from 'lucide-react'
import { PageContent } from '../components/layout/PageContent'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Switch } from '../components/ui/switch'
import { Textarea } from '../components/ui/textarea'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import ConfirmDeleteDialog from '../components/ui/ConfirmDeleteDialog'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { listAgents } from '../lib/agents-api'
import { formatAppDateTime } from '../lib/app-locale'
import {
  deleteWorkstream,
  getWorkstream,
  listWorkstreamRuns,
  patchWorkstream,
  replaceWorkstreamSteps,
  startWorkstreamRun,
  type WorkstreamDetail as WorkstreamDetailPayload,
  type WorkstreamOnDeadline,
  type WorkstreamRunRow,
  type WorkstreamStepInput,
  type WorkstreamStepKind,
  type WorkstreamWaitKind,
} from '../lib/workstreams-api'
import { runStatusBadgeVariant, workstreamRunPath } from '../lib/workstream-ui'
import { CaseBindingsCard } from '../components/workstreams/CaseBindingsCard'

type AgentOption = { id: string; name: string }

type StepDraft = {
  /** Existing step id, or null for a new step. */
  id: string | null
  /** Local list key (stable while editing). */
  key: string
  name: string
  kind: WorkstreamStepKind
  goal: string
  agent_id: string
  agent_role: string
  wait_kind: WorkstreamWaitKind
  deadline_hours: number
  on_deadline: WorkstreamOnDeadline
}

let draftKeySeq = 0
function nextDraftKey(): string {
  draftKeySeq += 1
  return `draft-${draftKeySeq}`
}

function emptyStep(): StepDraft {
  return {
    id: null,
    key: nextDraftKey(),
    name: '',
    kind: 'agent',
    goal: '',
    agent_id: '',
    agent_role: '',
    wait_kind: 'input',
    deadline_hours: 0,
    on_deadline: 'continue',
  }
}

const selectClass =
  'h-8 rounded-md border border-border/60 bg-bg-input/80 px-2 text-xs text-text-primary'

export default function WorkstreamDetail() {
  const { t, i18n } = useTranslation('nav')
  const { workstreamId } = useParams<{ workstreamId: string }>()
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workstream, setWorkstream] = useState<WorkstreamDetailPayload | null>(null)
  const [runs, setRuns] = useState<WorkstreamRunRow[]>([])
  const [agents, setAgents] = useState<AgentOption[]>([])

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [savingMeta, setSavingMeta] = useState(false)
  const [togglingEnabled, setTogglingEnabled] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [steps, setSteps] = useState<StepDraft[]>([])
  const [stepsDirty, setStepsDirty] = useState(false)
  const [savingSteps, setSavingSteps] = useState(false)

  const [runInput, setRunInput] = useState('')
  const [starting, setStarting] = useState(false)

  const load = useCallback(async () => {
    if (!workstreamId) return
    setLoading(true)
    setError(null)
    try {
      const [detail, runRows, agentRows] = await Promise.all([
        getWorkstream(workstreamId),
        listWorkstreamRuns({ workstreamId, limit: 25 }).catch(() => []),
        listAgents().catch(() => []),
      ])
      setWorkstream(detail)
      setName(detail.name)
      setDescription(detail.description ?? '')
      setRuns(runRows)
      setAgents(agentRows.map((a) => ({ id: a.id, name: a.name })))
      setSteps(
        detail.steps.map((s) => ({
          id: s.id,
          key: s.id,
          name: s.name,
          kind: s.kind,
          goal: s.goal,
          agent_id: s.agent_id ?? '',
          agent_role: s.agent_role ?? '',
          wait_kind: s.wait_kind,
          deadline_hours: s.deadline_hours,
          on_deadline: s.on_deadline,
        })),
      )
      setStepsDirty(false)
    } catch (err) {
      setError(formatApiErrorMessage(err, t('workstreamsPage.loadError')))
    } finally {
      setLoading(false)
    }
  }, [workstreamId, t])

  useEffect(() => {
    void load()
  }, [load])

  const metaDirty = useMemo(() => {
    if (!workstream) return false
    return name.trim() !== workstream.name || description.trim() !== (workstream.description ?? '')
  }, [workstream, name, description])

  const saveMeta = async () => {
    if (!workstream || !name.trim()) return
    setSavingMeta(true)
    try {
      const updated = await patchWorkstream(workstream.id, {
        name: name.trim(),
        description: description.trim(),
      })
      setWorkstream((prev) => (prev ? { ...prev, ...updated } : prev))
      toast.success(t('workstreamsPage.saved'))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.saveError')))
    } finally {
      setSavingMeta(false)
    }
  }

  const toggleEnabled = async (checked: boolean) => {
    if (!workstream) return
    setTogglingEnabled(true)
    try {
      const updated = await patchWorkstream(workstream.id, { enabled: checked })
      setWorkstream((prev) => (prev ? { ...prev, ...updated } : prev))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.saveError')))
    } finally {
      setTogglingEnabled(false)
    }
  }

  const confirmDelete = async () => {
    if (!workstream) return
    setDeleting(true)
    try {
      await deleteWorkstream(workstream.id)
      toast.success(t('workstreamsPage.deleted'))
      navigate('/workstreams')
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.deleteError')))
    } finally {
      setDeleting(false)
    }
  }

  const updateStep = (key: string, patch: Partial<StepDraft>) => {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)))
    setStepsDirty(true)
  }

  const moveStep = (index: number, delta: -1 | 1) => {
    setSteps((prev) => {
      const next = [...prev]
      const target = index + delta
      if (target < 0 || target >= next.length) return prev
      const [row] = next.splice(index, 1)
      next.splice(target, 0, row)
      return next
    })
    setStepsDirty(true)
  }

  const removeStep = (key: string) => {
    setSteps((prev) => prev.filter((s) => s.key !== key))
    setStepsDirty(true)
  }

  const addStep = () => {
    setSteps((prev) => [...prev, emptyStep()])
    setStepsDirty(true)
  }

  const saveSteps = async () => {
    if (!workstream) return
    if (steps.some((s) => !s.name.trim())) {
      toast.error(t('workstreamsPage.stepNameRequired'))
      return
    }
    setSavingSteps(true)
    try {
      const payload: WorkstreamStepInput[] = steps.map((s) => ({
        id: s.id,
        name: s.name.trim(),
        kind: s.kind,
        goal: s.goal,
        agent_id: s.kind === 'agent' && s.agent_id ? s.agent_id : null,
        agent_role: s.agent_role,
        wait_kind: s.wait_kind,
        deadline_hours: s.deadline_hours,
        on_deadline: s.on_deadline,
      }))
      const savedSteps = await replaceWorkstreamSteps(workstream.id, payload)
      setSteps(
        savedSteps.map((s) => ({
          id: s.id,
          key: s.id,
          name: s.name,
          kind: s.kind,
          goal: s.goal,
          agent_id: s.agent_id ?? '',
          agent_role: s.agent_role ?? '',
          wait_kind: s.wait_kind,
          deadline_hours: s.deadline_hours,
          on_deadline: s.on_deadline,
        })),
      )
      setStepsDirty(false)
      toast.success(t('workstreamsPage.stepsSaved'))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.stepsSaveError')))
    } finally {
      setSavingSteps(false)
    }
  }

  const startRun = async () => {
    if (!workstream) return
    if (steps.length === 0) {
      toast.error(t('workstreamsPage.needStep'))
      return
    }
    if (stepsDirty) {
      toast.error(t('workstreamsPage.saveStepsFirst'))
      return
    }
    setStarting(true)
    try {
      const run = await startWorkstreamRun(workstream.id, {
        input_kind: 'manual',
        input_text: runInput.trim(),
      })
      setRunInput('')
      toast.success(t('workstreamsPage.runStarted'))
      navigate(workstreamRunPath(run.id))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.runStartError')))
    } finally {
      setStarting(false)
    }
  }

  return (
    <PageContent width="xl" className="space-y-4 py-1">
      <Link
        to="/workstreams"
        className="inline-flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-text-primary"
      >
        <ArrowLeft size={14} />
        {t('workstreamsPage.back')}
      </Link>

      {loading ? (
        <CardGridSkeleton cards={3} className="lg:grid-cols-1" />
      ) : error || !workstream ? (
        <ApiErrorBanner message={error ?? t('workstreamsPage.notFound')} onRetry={() => void load()} />
      ) : (
        <>
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold text-text-heading">{workstream.name}</h1>
                {workstream.is_default ? (
                  <Badge variant="outline">{t('workstreamsPage.default')}</Badge>
                ) : null}
              </div>
              {workstream.description ? (
                <p className="mt-1 max-w-2xl text-sm text-text-muted">{workstream.description}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-text-muted">
                {workstream.enabled ? t('workstreamsPage.active') : t('workstreamsPage.paused')}
                <Switch
                  checked={workstream.enabled}
                  disabled={!isAdmin || togglingEnabled}
                  onCheckedChange={(checked) => void toggleEnabled(checked)}
                  aria-label={t('workstreamsPage.enabledToggle')}
                />
              </label>
              {isAdmin ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-status-error hover:text-status-error"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 size={14} className="mr-1" />
                  {t('workstreamsPage.delete')}
                </Button>
              ) : null}
            </div>
          </header>

          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <div className="space-y-4">
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base">{t('workstreamsPage.stepsTitle')}</CardTitle>
                  {isAdmin ? (
                    <div className="flex items-center gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={addStep}>
                        <Plus size={13} className="mr-1" />
                        {t('workstreamsPage.addStep')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={!stepsDirty || savingSteps}
                        onClick={() => void saveSteps()}
                      >
                        {savingSteps ? <Loader2 size={13} className="mr-1 animate-spin" /> : null}
                        {t('workstreamsPage.saveSteps')}
                      </Button>
                    </div>
                  ) : null}
                </CardHeader>
                <CardContent className="space-y-3">
                  {steps.length === 0 ? (
                    <p className="text-sm text-text-muted">{t('workstreamsPage.noStepsYet')}</p>
                  ) : (
                    steps.map((step, index) => (
                      <div key={step.key} className="rounded-lg border border-border/60 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="w-5 text-sm tabular-nums text-text-muted">{index + 1}.</span>
                          <Input
                            value={step.name}
                            disabled={!isAdmin}
                            onChange={(e) => updateStep(step.key, { name: e.target.value })}
                            placeholder={t('workstreamsPage.stepNamePlaceholder')}
                            className="h-8 min-w-[10rem] flex-1 text-sm"
                          />
                          <select
                            value={step.kind}
                            disabled={!isAdmin}
                            onChange={(e) =>
                              updateStep(step.key, { kind: e.target.value as WorkstreamStepKind })
                            }
                            className={selectClass}
                            aria-label={t('workstreamsPage.stepKind')}
                          >
                            <option value="agent">{t('workstreamsPage.kinds.agent')}</option>
                            <option value="wait">{t('workstreamsPage.kinds.wait')}</option>
                            <option value="gate">{t('workstreamsPage.kinds.gate')}</option>
                          </select>
                          {isAdmin ? (
                            <span className="flex items-center gap-0.5">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                disabled={index === 0}
                                aria-label={t('workstreamsPage.moveUp')}
                                onClick={() => moveStep(index, -1)}
                              >
                                <ArrowUp size={13} />
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                disabled={index === steps.length - 1}
                                aria-label={t('workstreamsPage.moveDown')}
                                onClick={() => moveStep(index, 1)}
                              >
                                <ArrowDown size={13} />
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-status-error"
                                aria-label={t('workstreamsPage.removeStep')}
                                onClick={() => removeStep(step.key)}
                              >
                                <Trash2 size={13} />
                              </Button>
                            </span>
                          ) : null}
                        </div>

                        {step.kind !== 'wait' ? (
                          <Textarea
                            value={step.goal}
                            disabled={!isAdmin}
                            onChange={(e) => updateStep(step.key, { goal: e.target.value })}
                            placeholder={
                              step.kind === 'gate'
                                ? t('workstreamsPage.gateGoalPlaceholder')
                                : t('workstreamsPage.goalPlaceholder')
                            }
                            className="mt-2 min-h-[64px] text-sm"
                          />
                        ) : null}

                        {step.kind === 'agent' ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                            <span>{t('workstreamsPage.agentLabel')}</span>
                            <select
                              value={step.agent_id}
                              disabled={!isAdmin}
                              onChange={(e) => updateStep(step.key, { agent_id: e.target.value })}
                              className={selectClass}
                              aria-label={t('workstreamsPage.agentLabel')}
                            >
                              <option value="">{t('workstreamsPage.agentAuto')}</option>
                              {agents.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : null}

                        {step.kind === 'wait' ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                            <span>{t('workstreamsPage.waitFor')}</span>
                            <select
                              value={step.wait_kind}
                              disabled={!isAdmin}
                              onChange={(e) =>
                                updateStep(step.key, {
                                  wait_kind: e.target.value as WorkstreamWaitKind,
                                })
                              }
                              className={selectClass}
                              aria-label={t('workstreamsPage.waitFor')}
                            >
                              <option value="input">{t('workstreamsPage.waitKinds.input')}</option>
                              <option value="event">{t('workstreamsPage.waitKinds.event')}</option>
                              <option value="time">{t('workstreamsPage.waitKinds.time')}</option>
                            </select>
                            <span>{t('workstreamsPage.deadlineHours')}</span>
                            <Input
                              type="number"
                              min={0}
                              value={step.deadline_hours}
                              disabled={!isAdmin}
                              onChange={(e) =>
                                updateStep(step.key, {
                                  deadline_hours: Math.max(0, Number(e.target.value) || 0),
                                })
                              }
                              className="h-8 w-20 text-xs"
                            />
                            <span>{t('workstreamsPage.onDeadline')}</span>
                            <select
                              value={step.on_deadline}
                              disabled={!isAdmin}
                              onChange={(e) =>
                                updateStep(step.key, {
                                  on_deadline: e.target.value as WorkstreamOnDeadline,
                                })
                              }
                              className={selectClass}
                              aria-label={t('workstreamsPage.onDeadline')}
                            >
                              <option value="continue">{t('workstreamsPage.onDeadlineOptions.continue')}</option>
                              <option value="remind_then_continue">
                                {t('workstreamsPage.onDeadlineOptions.remind_then_continue')}
                              </option>
                              <option value="fail">{t('workstreamsPage.onDeadlineOptions.fail')}</option>
                            </select>
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('workstreamsPage.runsTitle')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {runs.length === 0 ? (
                    <p className="text-sm text-text-muted">{t('workstreamsPage.noRuns')}</p>
                  ) : (
                    runs.map((run) => (
                      <Link
                        key={run.id}
                        to={workstreamRunPath(run.id)}
                        className="row-interactive flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2 text-sm transition-colors hover:border-border hover:bg-bg-muted/40"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-text-heading">
                            {run.started_at
                              ? formatAppDateTime(new Date(run.started_at), i18n.language)
                              : run.id.slice(0, 8)}
                          </span>
                          <span className="block truncate text-xs text-text-muted">
                            {run.summary || run.input_text || run.input_kind}
                          </span>
                        </span>
                        <Badge variant={runStatusBadgeVariant(run.status)} className="shrink-0">
                          {t(`workstreamsPage.status.${run.status}`, { defaultValue: run.status })}
                        </Badge>
                      </Link>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('workstreamsPage.startRunTitle')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Textarea
                    value={runInput}
                    onChange={(e) => setRunInput(e.target.value)}
                    placeholder={t('workstreamsPage.runInputPlaceholder')}
                    className="min-h-[88px] text-sm"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={starting || !workstream.enabled || steps.length === 0}
                    title={
                      steps.length === 0
                        ? t('workstreamsPage.needStep')
                        : !workstream.enabled
                          ? t('workstreamsPage.pausedHint')
                          : undefined
                    }
                    onClick={() => void startRun()}
                  >
                    {starting ? (
                      <Loader2 size={13} className="mr-1 animate-spin" />
                    ) : (
                      <Play size={13} className="mr-1" />
                    )}
                    {t('workstreamsPage.startRun')}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('workstreamsPage.aboutTitle')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="workstream-name">{t('workstreamsPage.nameLabel')}</Label>
                    <Input
                      id="workstream-name"
                      value={name}
                      disabled={!isAdmin}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="workstream-description">{t('workstreamsPage.descriptionLabel')}</Label>
                    <Textarea
                      id="workstream-description"
                      value={description}
                      disabled={!isAdmin}
                      onChange={(e) => setDescription(e.target.value)}
                      className="min-h-[64px] text-sm"
                    />
                  </div>
                  {isAdmin ? (
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        disabled={!metaDirty || savingMeta || !name.trim()}
                        onClick={() => void saveMeta()}
                      >
                        {savingMeta ? <Loader2 size={13} className="mr-1 animate-spin" /> : null}
                        {t('workstreamsPage.save')}
                      </Button>
                    </div>
                  ) : null}
                  <CaseBindingsCard targetKind="workstream" targetId={workstream.id} canEdit={isAdmin} />
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}

      {deleteOpen && workstream ? (
        <ConfirmDeleteDialog
          title={t('workstreamsPage.deleteTitle')}
          itemLabel={t('workstreamsPage.deleteItem')}
          itemName={workstream.name}
          impactText={t('workstreamsPage.deleteImpact')}
          isDeleting={deleting}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </PageContent>
  )
}
