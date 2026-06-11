import { useCallback, useEffect, useState } from 'react'
import { Loader2, Pause, Play, XCircle } from 'lucide-react'
import {
  cancelAgentTask,
  fetchRunEvents,
  getAgentTask,
  listTaskArtifacts,
  resumeAgentTask,
  type AgentTask,
  type TaskArtifact,
} from '../../lib/orchestration-api'
import { Button } from '../ui/button'

type Props = {
  taskId: string
}

type RunMeter = {
  contextPct: number | null
  costCents: number | null
  maxCostCents: number | null
  model: string | null
}

export function OrchestrationPanel({ taskId }: Props) {
  const [task, setTask] = useState<AgentTask | null>(null)
  const [artifacts, setArtifacts] = useState<TaskArtifact[]>([])
  const [meter, setMeter] = useState<RunMeter | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [t, arts] = await Promise.all([getAgentTask(taskId), listTaskArtifacts(taskId)])
      setTask(t)
      setArtifacts(arts)
      const runId = typeof t.context?.active_run_id === 'string' ? t.context.active_run_id : null
      if (runId) {
        try {
          const run = await fetchRunEvents(runId)
          const usage = [...run.events].reverse().find((e) => e.type === 'context_usage')
          setMeter({
            contextPct: typeof usage?.payload?.context_pct === 'number' ? usage.payload.context_pct : null,
            costCents: typeof t.context?.cost_cents === 'number' ? t.context.cost_cents : null,
            maxCostCents: typeof usage?.payload?.max_cost_cents === 'number' ? usage.payload.max_cost_cents : null,
            model: typeof run.runtime_snapshot?.model === 'string' ? run.runtime_snapshot.model : null,
          })
        } catch {
          /* run events not available yet */
        }
      }
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load task')
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    void load()
    const active = task?.status === 'running' || task?.status === 'queued'
    if (!active) return
    const t = setInterval(() => void load(), 3000)
    return () => clearInterval(t)
  }, [load, task?.status])

  const onCancel = async () => {
    setBusy(true)
    try {
      await cancelAgentTask(taskId)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const onResume = async () => {
    setBusy(true)
    try {
      await resumeAgentTask(taskId)
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (loading && !task) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-muted p-3">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading orchestration...
      </div>
    )
  }

  if (error) {
    return <p className="text-sm text-destructive p-3">{error}</p>
  }

  if (!task) return null

  const isActive = task.status === 'running' || task.status === 'queued'
  const isResumable = task.status === 'paused' || task.status === 'awaiting_decision'
  const budgetPct =
    meter?.costCents != null && meter?.maxCostCents
      ? Math.min(100, Math.round((meter.costCents / meter.maxCostCents) * 100))
      : null

  return (
    <div className="border border-border/60 rounded-lg bg-bg-elevated p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-text-primary">{task.title}</p>
          <p className="text-xs text-text-muted capitalize">
            Status: {task.status.replace(/_/g, ' ')}
            {task.pause_reason ? ` (${task.pause_reason.replace(/_/g, ' ')})` : null}
            {meter?.model ? ` | ${meter.model}` : null}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {isActive && (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void onCancel()}>
              <XCircle className="h-3.5 w-3.5 mr-1" />
              Cancel
            </Button>
          )}
          {isResumable && (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void onResume()}>
              <Play className="h-3.5 w-3.5 mr-1" />
              Resume
            </Button>
          )}
          {task.status === 'completed' && (
            <span className="text-xs text-status-success flex items-center gap-1">
              <Play className="h-3.5 w-3.5" />
              Done
            </span>
          )}
          {task.status === 'paused' && !isResumable && (
            <span className="text-xs text-text-muted flex items-center gap-1">
              <Pause className="h-3.5 w-3.5" />
              Paused
            </span>
          )}
        </div>
      </div>

      {(meter?.contextPct != null || meter?.costCents != null) && (
        <div className="space-y-1.5 text-xs">
          {meter?.contextPct != null && (
            <div>
              <div className="flex justify-between text-text-muted">
                <span>Context window</span>
                <span>{meter.contextPct}%</span>
              </div>
              <div className="mt-0.5 h-1.5 rounded-full bg-bg-surface overflow-hidden">
                <div className="h-full bg-accent" style={{ width: `${meter.contextPct}%` }} />
              </div>
            </div>
          )}
          {meter?.costCents != null && (
            <div>
              <div className="flex justify-between text-text-muted">
                <span>Cost</span>
                <span>
                  {meter.costCents} cents{meter.maxCostCents ? ` / ${meter.maxCostCents}` : ''}
                </span>
              </div>
              {budgetPct != null && (
                <div className="mt-0.5 h-1.5 rounded-full bg-bg-surface overflow-hidden">
                  <div
                    className={`h-full ${budgetPct >= 100 ? 'bg-status-error' : 'bg-accent'}`}
                    style={{ width: `${budgetPct}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {artifacts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-text-muted uppercase tracking-wide">Artifacts</p>
          {artifacts.map((a) => (
            <details key={a.id} className="rounded border border-border/40 bg-bg-surface p-2 text-xs">
              <summary className="cursor-pointer text-text-primary">{a.name}</summary>
              <pre className="mt-2 whitespace-pre-wrap text-text-muted max-h-40 overflow-y-auto">
                {typeof a.content?.text === 'string'
                  ? a.content.text
                  : JSON.stringify(a.content, null, 2)}
              </pre>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}
