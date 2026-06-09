import { useCallback, useEffect, useState } from 'react'
import { Loader2, Pause, Play, XCircle } from 'lucide-react'
import {
  cancelAgentTask,
  getAgentTask,
  listTaskArtifacts,
  type AgentTask,
  type TaskArtifact,
} from '../../lib/orchestration-api'
import { Button } from '../ui/button'

type Props = {
  taskId: string
}

export function OrchestrationPanel({ taskId }: Props) {
  const [task, setTask] = useState<AgentTask | null>(null)
  const [artifacts, setArtifacts] = useState<TaskArtifact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [t, arts] = await Promise.all([getAgentTask(taskId), listTaskArtifacts(taskId)])
      setTask(t)
      setArtifacts(arts)
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
    await cancelAgentTask(taskId)
    await load()
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

  return (
    <div className="border border-border/60 rounded-lg bg-bg-elevated p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-text-primary">{task.title}</p>
          <p className="text-xs text-text-muted capitalize">
            Status: {task.status.replace(/_/g, ' ')}
            {task.current_step_id ? ` | Step active` : null}
          </p>
        </div>
        {(task.status === 'running' || task.status === 'queued') && (
          <Button type="button" variant="outline" size="sm" onClick={() => void onCancel()}>
            <XCircle className="h-3.5 w-3.5 mr-1" />
            Cancel
          </Button>
        )}
        {task.status === 'paused' && (
          <Button type="button" variant="outline" size="sm" disabled>
            <Pause className="h-3.5 w-3.5 mr-1" />
            Paused
          </Button>
        )}
        {task.status === 'completed' && (
          <span className="text-xs text-status-success flex items-center gap-1">
            <Play className="h-3.5 w-3.5" />
            Done
          </span>
        )}
      </div>

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
