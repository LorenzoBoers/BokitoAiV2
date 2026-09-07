import { Check, ListPlus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  completeAgentTask,
  listAgentTasks,
  type AgentTask,
} from '../../lib/orchestration-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'

type Props = {
  signalId: string
}

function isOpenFollowUp(task: AgentTask): boolean {
  if (task.status === 'completed' || task.status === 'cancelled' || task.status === 'rejected') {
    return false
  }
  return task.assignee_kind === 'human' || Boolean(task.scheduled_for) || task.status === 'awaiting_human'
}

export function ThreadFollowUpsList({ signalId }: Props) {
  const { t } = useTranslation('communication')
  const [rows, setRows] = useState<AgentTask[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const tasks = await listAgentTasks({ signalId, openOnly: true }).catch(() => [])
    setRows(tasks.filter(isOpenFollowUp))
  }, [signalId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ signalId?: string }>).detail
      if (detail?.signalId && detail.signalId !== signalId) return
      void load()
    }
    window.addEventListener('bokito:agent-tasks-changed', onChanged)
    return () => window.removeEventListener('bokito:agent-tasks-changed', onChanged)
  }, [load, signalId])

  const complete = async (taskId: string) => {
    setBusyId(taskId)
    setError(null)
    try {
      await completeAgentTask(taskId)
      window.dispatchEvent(
        new CustomEvent('bokito:agent-tasks-changed', { detail: { signalId } }),
      )
      await load()
    } catch (err) {
      setError(formatApiErrorMessage(err, t('contactPanel.followUpCompleteError')))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          {t('contactPanel.followUps')}
        </h3>
        <Link
          to="/agenda?view=list&source=tasks"
          className="text-[11px] font-medium text-accent hover:underline"
        >
          {t('contactPanel.openAgendaFollowUps')}
        </Link>
      </div>
      {error ? <p className="text-[11px] text-status-error">{error}</p> : null}
      {rows.length === 0 ? (
        <p className="text-[11.5px] text-text-muted">{t('contactPanel.noFollowUps')}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((task) => (
            <li
              key={task.id}
              className={cn(
                'flex items-start gap-2 rounded-md border border-border/50 bg-bg-surface px-2 py-1.5',
                task.status === 'overdue' || task.status === 'awaiting_human'
                  ? 'border-status-warning/30'
                  : '',
              )}
            >
              <ListPlus size={12} className="mt-0.5 shrink-0 text-text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-text-heading">{task.title}</p>
                <p className="text-[10px] uppercase tracking-wide text-text-muted">
                  {task.status.replace(/_/g, ' ')}
                  {task.scheduled_for
                    ? ` · ${new Date(task.scheduled_for).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`
                    : ''}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 shrink-0 gap-1 px-1.5 text-[10px]"
                disabled={busyId === task.id}
                onClick={() => void complete(task.id)}
                title={t('contactPanel.completeFollowUp')}
              >
                <Check size={11} aria-hidden />
                {t('contactPanel.completeFollowUp')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
