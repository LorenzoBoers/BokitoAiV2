import { listMessages } from './messages-api'
import { getProjectBudget } from './projects-api'
import { getProjectOrchestration } from './project-orchestration-api'
import {
  countMessagesForProject,
  deriveWorkerStatus,
  latestActivityAtByProject,
  latestRunFailedByProject,
  resolveLastActiveAt,
  type WorkerStatusSnapshot,
} from './project-worker-status'
import type { ProjectRow } from './projects-api'
import { listWorkLogs } from './work-logs-api'

export type ProjectWorkerStatusMap = Record<string, WorkerStatusSnapshot>

const POLL_MS = 60_000

export async function fetchProjectWorkerStatusMap(
  projects: ProjectRow[],
): Promise<ProjectWorkerStatusMap> {
  if (projects.length === 0) return {}

  const projectIds = new Set(projects.map((p) => p.id))

  const [awaitingMessages, runningLogs, recentLogs] = await Promise.all([
    listMessages({ status: 'awaiting_human' }),
    listWorkLogs({ status: 'running', limit: 100 }),
    listWorkLogs({ limit: 100 }),
  ])

  const runningProjectIds = new Set(
    runningLogs.filter((l) => projectIds.has(l.project_id)).map((l) => l.project_id),
  )
  const lastFailed = latestRunFailedByProject(
    recentLogs.filter((l) => projectIds.has(l.project_id)),
  )
  const lastActivity = latestActivityAtByProject(
    recentLogs.filter((l) => projectIds.has(l.project_id)),
  )

  const orchestrationAndBudget = await Promise.all(
    projects.map(async (project) => {
      const [orch, budget] = await Promise.all([
        getProjectOrchestration(project.id).catch(() => null),
        getProjectBudget(project.id).catch(() => null),
      ])
      return { projectId: project.id, orchestration: orch, budgetBlocked: budget?.blocked ?? false }
    }),
  )

  const orchByProject = new Map(
    orchestrationAndBudget.map((r) => [
      r.projectId,
      { orchestration: r.orchestration, budgetBlocked: r.budgetBlocked },
    ]),
  )

  const map: ProjectWorkerStatusMap = {}
  for (const project of projects) {
    const { blockingCount, attentionCount } = countMessagesForProject(
      awaitingMessages,
      project.id,
    )
    const meta = orchByProject.get(project.id)
    map[project.id] = deriveWorkerStatus({
      project,
      blockingCount,
      attentionCount,
      budgetBlocked: meta?.budgetBlocked ?? false,
      hasRunningWorkLog: runningProjectIds.has(project.id),
      runAwaitingHuman: false,
      lastRunFailed: lastFailed.get(project.id) ?? false,
      lastActiveAt: resolveLastActiveAt(
        lastActivity.get(project.id),
        meta?.orchestration?.last_po_wake_at,
      ),
      orchestration: meta?.orchestration ?? null,
    })
  }

  return map
}

export { POLL_MS }
