import { config } from './config.js'

const workforceBase = () => {
  const base = config.xanoBaseUrl
  if (!base) return ''
  return `${base}/api:workforce`
}

export async function xanoWorkerFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${workforceBase()}${path.startsWith('/') ? path : `/${path}`}`
  const headers = new Headers(init.headers)
  if (config.xanoWorkerApiKey) {
    headers.set('Authorization', `Bearer ${config.xanoWorkerApiKey}`)
  }
  headers.set('Content-Type', headers.get('Content-Type') || 'application/json')
  return fetch(url, { ...init, headers })
}

export async function fetchRunContext(projectId: string, agentId: string) {
  const res = await xanoWorkerFetch('/runs/context', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, agent_id: agentId }),
  })
  if (!res.ok) {
    throw new Error(`fetchRunContext failed: ${res.status} ${await res.text()}`)
  }
  return res.json() as Promise<Record<string, unknown>>
}
