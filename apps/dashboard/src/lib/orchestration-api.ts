import { appRoutes } from '../api/routes/app.routes'
import { apiDelete, apiGet, apiPatch, apiPost } from './api'

export async function fetchRunEvents(runId: string): Promise<{
  run_id: string
  status: string
  runtime_snapshot: Record<string, unknown>
  events: Array<{ type: string; message: string; payload: Record<string, unknown>; sequence: number }>
}> {
  return apiGet(appRoutes.orchestration.runEvents(runId))
}

export type TriggerKind = 'cron' | 'interval' | 'heartbeat' | 'webhook' | 'once' | 'event'

export type Trigger = {
  id: string
  name: string
  kind: TriggerKind
  cron_expr: string
  interval_minutes: number
  agent_id: string | null
  agent_role: string
  workstream_id: string | null
  instructions: string
  has_webhook_secret: boolean
  enabled: boolean
  last_run_at: string | null
  next_run_at: string | null
  last_status: string
  created_at: string | null
  webhook_secret?: string
}

export async function listTriggers(): Promise<Trigger[]> {
  const res = await apiGet<{ triggers: Trigger[] }>(appRoutes.triggers.list)
  return res.triggers ?? []
}

export async function createTrigger(body: {
  name: string
  kind: TriggerKind
  cron_expr?: string
  interval_minutes?: number
  agent_id?: string
  agent_role?: string
  workstream_id?: string
  instructions?: string
  enabled?: boolean
  run_at?: string
}): Promise<Trigger> {
  return apiPost<Trigger>(appRoutes.triggers.list, body)
}

export async function updateTrigger(
  triggerId: string,
  body: Partial<Trigger> & { run_at?: string },
): Promise<Trigger> {
  return apiPatch<Trigger>(appRoutes.triggers.byId(triggerId), body)
}

export async function deleteTrigger(triggerId: string): Promise<void> {
  await apiDelete(appRoutes.triggers.byId(triggerId))
}

export async function runTrigger(triggerId: string): Promise<{ status: string }> {
  return apiPost(appRoutes.triggers.run(triggerId), {})
}

export async function rotateWebhookSecret(triggerId: string): Promise<Trigger> {
  return apiPost<Trigger>(appRoutes.triggers.rotateWebhookSecret(triggerId), {})
}

export type WebhookTestResult = {
  ok: boolean
  status?: string
  run_id?: string
  task_id?: string
}

export async function testWebhookTrigger(triggerId: string): Promise<WebhookTestResult> {
  return apiPost<WebhookTestResult>(appRoutes.triggers.testWebhook(triggerId), {})
}

export function webhookHookUrl(triggerId: string): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/api/hooks/${triggerId}`
  }
  return `/api/hooks/${triggerId}`
}

