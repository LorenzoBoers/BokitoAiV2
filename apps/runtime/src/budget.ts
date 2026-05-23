import { config } from './config.js'
import { xanoWorkerFetch } from './xano-client.js'

export async function checkTokenBudget(projectId: string): Promise<{
  allowed: boolean
  remainingToday: number
  remainingHour: number
}> {
  const qs = config.xanoWorkerApiKey
    ? `?worker_api_key=${encodeURIComponent(config.xanoWorkerApiKey)}`
    : ''
  const res = await xanoWorkerFetch(`/projects/${projectId}/budget${qs}`)
  if (!res.ok) {
    return { allowed: true, remainingToday: 999999, remainingHour: 999999 }
  }
  const data = (await res.json()) as {
    remaining_today?: number
    remaining_hour?: number
    blocked?: boolean
  }
  const remainingToday = data.remaining_today ?? 0
  const remainingHour = data.remaining_hour ?? 0
  return {
    allowed: !data.blocked && remainingToday > 0 && remainingHour > 0,
    remainingToday,
    remainingHour,
  }
}
