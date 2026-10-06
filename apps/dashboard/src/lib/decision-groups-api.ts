import { appRoutes } from '../api/routes'
import { apiGet, apiPost } from './api'

export type DecisionGroup = {
  title: string
  count: number
  withoutThread: number
  latestAt: string | null
}

type RawGroup = { title: string; count: number; without_thread: number; latest_at?: string | null }

export async function fetchDecisionGroups(): Promise<DecisionGroup[]> {
  const rows = await apiGet<RawGroup[]>(appRoutes.notifications.decisionGroups)
  return rows.map((row) => ({
    title: row.title,
    count: row.count,
    withoutThread: row.without_thread,
    latestAt: row.latest_at ?? null,
  }))
}

export type DismissDecisionsFilter = {
  title?: string
  withoutThreadOnly?: boolean
  olderThanDays?: number
}

export async function dismissDecisions(filter: DismissDecisionsFilter): Promise<number> {
  const raw = await apiPost<{ dismissed: number }>(appRoutes.notifications.decisionsDismiss, {
    ...(filter.title !== undefined ? { title: filter.title } : {}),
    ...(filter.withoutThreadOnly ? { without_thread_only: true } : {}),
    ...(filter.olderThanDays !== undefined ? { older_than_days: filter.olderThanDays } : {}),
  })
  return raw.dismissed
}

/** Groups worth a bulk action: more than one card of the same kind. */
export function bulkDismissCandidates(groups: DecisionGroup[], minCount = 2): DecisionGroup[] {
  return groups.filter((group) => group.count >= minCount)
}
