import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { WorkerStatusDot } from './WorkerStatusDot'
import { useProjectContext } from '../../context/ProjectContext'
import { useOptionalProjectHubNav } from '../../context/ProjectHubNavContext'
import {
  deriveWorkerStatus,
  workerStatusTextClass,
  countMessagesForProject,
  latestActivityAtByProject,
  latestRunFailedByProject,
  resolveLastActiveAt,
  formatWorkerStatusLabel,
  type WorkerStatusSnapshot,
} from '../../lib/project-worker-status'
import { listMessages } from '../../lib/messages-api'
import { getProjectBudget } from '../../lib/projects-api'
import { getProjectOrchestration } from '../../lib/project-orchestration-api'
import { listWorkLogs } from '../../lib/work-logs-api'
import { cn } from '../../lib/utils'

function formatWakeAt(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return null
  return d.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
}

type WorkerStatusStripProps = {
  className?: string
}

export function WorkerStatusStrip({ className }: WorkerStatusStripProps) {
  const { t, i18n } = useTranslation('nav')
  const { project, projectId, loading: projectLoading } = useProjectContext()
  const hubNav = useOptionalProjectHubNav()
  const [localStatus, setLocalStatus] = useState<WorkerStatusSnapshot | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const hubStatus = hubNav?.getWorkerStatus(projectId) ?? null

  useEffect(() => {
    if (!project || hubStatus) {
      setLocalStatus(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    ;(async () => {
      try {
        const [awaitingMessages, runningLogs, recentLogs, orchestration, budget] =
          await Promise.all([
            listMessages({ status: 'awaiting_human', project_id: projectId }),
            listWorkLogs({ project_id: projectId, status: 'running', limit: 5 }),
            listWorkLogs({ project_id: projectId, limit: 10 }),
            getProjectOrchestration(projectId).catch(() => null),
            getProjectBudget(projectId).catch(() => null),
          ])
        if (cancelled) return
        const { blockingCount, attentionCount } = countMessagesForProject(
          awaitingMessages,
          projectId,
        )
        const lastFailed = latestRunFailedByProject(recentLogs).get(projectId) ?? false
        const lastActivity = latestActivityAtByProject(recentLogs).get(projectId)
        setLocalStatus(
          deriveWorkerStatus({
            project,
            blockingCount,
            attentionCount,
            budgetBlocked: budget?.blocked ?? false,
            hasRunningWorkLog: runningLogs.length > 0,
            runAwaitingHuman: false,
            lastRunFailed: lastFailed,
            lastActiveAt: resolveLastActiveAt(lastActivity, orchestration?.last_po_wake_at),
            orchestration,
          }),
        )
      } catch {
        if (!cancelled) setLocalStatus(null)
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [project, projectId, hubStatus])

  const status = hubStatus ?? localStatus
  const loading = projectLoading || (detailLoading && !status)

  if (loading || !project) {
    return (
      <div
        className={cn(
          'mb-4 h-14 animate-pulse rounded-xl border border-border/60 bg-bg-surface/50',
          className,
        )}
      />
    )
  }

  if (!status) return null

  const primaryLabel = formatWorkerStatusLabel(status, t, i18n.language)
  const setupLabel = status.setupKey ? t(status.setupKey) : null
  const nextWake = formatWakeAt(status.hints.nextWakeAt, i18n.language)

  const actionLink =
    status.primary === 'blocked' || status.primary === 'attention'
      ? { to: `/project/${projectId}/communication`, label: t('backgroundWorkers.strip.openCommunication') }
      : status.primary === 'error'
        ? { to: `/project/${projectId}/workforce`, label: t('backgroundWorkers.strip.viewRuns') }
        : status.primary === 'paused' || status.primary === 'scheduled'
          ? { to: `/project/${projectId}/orchestration`, label: t('backgroundWorkers.strip.openOrchestration') }
          : null

  return (
    <div
      className={cn(
        'mb-4 rounded-xl border border-border/70 bg-bg-surface/80 px-4 py-3',
        className,
      )}
      role="status"
      aria-label={primaryLabel}
    >
      <div className="flex flex-wrap items-start gap-3">
        <WorkerStatusDot primary={status.primary} badgeCount={status.badgeCount} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <p className={cn('text-sm font-medium', workerStatusTextClass(status.primary))}>
            {primaryLabel}
            {status.badgeCount > 0 ? (
              <span className="ml-1.5 font-normal text-text-muted">
                ({status.badgeCount})
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-text-muted">
            {setupLabel ?? t('backgroundWorkers.setup.ready')}
            {project.github_repo_full_name ? (
              <span className="text-text-muted"> · {project.github_repo_full_name}</span>
            ) : null}
            {nextWake && status.primary === 'scheduled' ? (
              <span>
                {' '}
                · {t('backgroundWorkers.strip.nextWake', { time: nextWake })}
              </span>
            ) : null}
            {status.hints.budgetBlocked ? (
              <span className="text-status-error">
                {' '}
                · {t('backgroundWorkers.strip.budgetBlocked')}
              </span>
            ) : null}
          </p>
        </div>
        {actionLink ? (
          <Link
            to={actionLink.to}
            className="shrink-0 text-xs font-medium text-accent hover:underline"
          >
            {actionLink.label}
          </Link>
        ) : null}
      </div>
    </div>
  )
}
