import { randomUUID } from 'node:crypto'
import { config } from './config.js'

const workforceBase = () => {
  const base = config.xanoBaseUrl
  if (!base) return ''
  return `${base}/api:workforce`
}

function withBodyAuth(body: string, token?: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    if (typeof parsed !== 'object' || parsed == null) return body
    if (token) {
      parsed.auth_token = token
    } else if (config.xanoWorkerApiKey && parsed.worker_api_key == null) {
      parsed.worker_api_key = config.xanoWorkerApiKey
    }
    return JSON.stringify(parsed)
  } catch {
    return body
  }
}

export async function xanoWorkerFetch(
  path: string,
  init: RequestInit = {},
  token?: string
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${workforceBase()}${path.startsWith('/') ? path : `/${path}`}`
  const headers = new Headers(init.headers)
  const bearer = token || config.xanoWorkerApiKey
  if (bearer) {
    headers.set('Authorization', `Bearer ${bearer}`)
  }
  headers.set('Content-Type', headers.get('Content-Type') || 'application/json')
  const body =
    typeof init.body === 'string' && init.body.length > 0 ? withBodyAuth(init.body, token) : init.body
  return fetch(url, { ...init, headers, body })
}

export interface StartRunResult {
  work_log_id: string
  run_id: string
  run_token: string
}

export async function startRun(input: {
  project_id: string
  tenant_id: string
  agent_id: string
  task_subject?: string
  trigger_message_id?: string
}): Promise<StartRunResult> {
  const runId = randomUUID()
  const res = await xanoWorkerFetch('/runs/start', {
    method: 'POST',
    body: JSON.stringify({
      project_id: input.project_id,
      tenant_id: input.tenant_id,
      agent_id: input.agent_id,
      run_id: runId,
      task_subject: input.task_subject || 'Agent run',
      trigger_message_id: input.trigger_message_id,
    }),
  })
  if (!res.ok) {
    throw new Error(`startRun failed: ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as StartRunResult
  return {
    work_log_id: String(data.work_log_id || runId),
    run_id: String(data.run_id || runId),
    run_token: String(data.run_token || config.xanoWorkerApiKey),
  }
}

export async function completeRun(
  workLogId: string,
  input: { status: 'completed' | 'failed'; token_input?: number; token_output?: number },
  runToken?: string
): Promise<void> {
  const res = await xanoWorkerFetch(
    '/runs/complete',
    {
      method: 'POST',
      body: JSON.stringify({
        work_log_id: workLogId,
        status: input.status,
        token_input: input.token_input ?? 0,
        token_output: input.token_output ?? 0,
      }),
    },
    runToken
  )
  if (!res.ok) {
    console.warn(`[xano] completeRun failed: ${res.status}`)
  }
}

export async function fetchRunContext(
  projectId: string,
  agentId: string,
  workLogId?: string
): Promise<Record<string, unknown>> {
  const res = await xanoWorkerFetch('/runs/context', {
    method: 'POST',
    body: JSON.stringify({
      project_id: projectId,
      agent_id: agentId,
      work_log_id: workLogId,
    }),
  })
  if (!res.ok) {
    throw new Error(`fetchRunContext failed: ${res.status} ${await res.text()}`)
  }
  return res.json() as Promise<Record<string, unknown>>
}
