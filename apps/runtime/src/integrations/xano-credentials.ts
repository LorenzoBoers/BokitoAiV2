import { config } from '../config.js'

const integrationsBase = () => {
  const base = config.xanoBaseUrl
  if (!base) return ''
  return `${base}/api:integrations`
}

export interface WorkerRepoCredentials {
  access_token: string
  github_repo_full_name: string
  github_default_branch: string
  connection_id?: string
}

export async function fetchWorkerRepoCredentials(
  tenantId: string,
  projectId: string,
): Promise<WorkerRepoCredentials> {
  const genericUrl = `${integrationsBase()}/integrations/worker/credentials`
  const legacyUrl = `${integrationsBase()}/github/worker/token`
  const body = {
    tenant_id: tenantId,
    project_id: projectId,
    worker_secret: config.workerInboundSecret,
  }

  for (const url of [genericUrl, legacyUrl]) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) continue
      return res.json() as Promise<WorkerRepoCredentials>
    } catch {
      continue
    }
  }

  throw new Error('worker credentials failed for project repo')
}
