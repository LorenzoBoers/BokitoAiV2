import { config } from '../config.js'

const integrationsBase = () => {
  const base = config.xanoBaseUrl
  if (!base) return ''
  return `${base}/api:integrations`
}

export interface WorkerMcpCredentials {
  access_token: string
  refresh_token?: string
  token_type?: string
  mcp_remote_url: string
  transport: string
  provider_slug: string
  connection_id: string
}

export async function fetchWorkerMcpCredentials(
  tenantId: string,
  connectionId: string,
): Promise<WorkerMcpCredentials> {
  const url = `${integrationsBase()}/integrations/worker/mcp-credentials`
  const body = {
    tenant_id: tenantId,
    connection_id: connectionId,
    worker_secret: config.workerInboundSecret,
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    throw new Error(`worker mcp credentials failed: ${res.status}`)
  }

  return res.json() as Promise<WorkerMcpCredentials>
}
