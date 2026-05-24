import { config } from '../config.js'
import { fetchWorkerRepoCredentials } from '../integrations/xano-credentials.js'

const integrationsBase = () => {
  const base = config.xanoBaseUrl
  if (!base) return ''
  return `${base}/api:integrations`
}

export interface GithubWorkerToken {
  access_token: string
  github_repo_full_name: string
  github_default_branch: string
}

export async function fetchGithubWorkerToken(
  tenantId: string,
  projectId: string,
): Promise<GithubWorkerToken> {
  return fetchWorkerRepoCredentials(tenantId, projectId)
}

export async function patchProjectIndexStatus(input: {
  tenant_id: string
  project_id: string
  status: string
  error?: string
  repo_last_commit_sha?: string
}): Promise<void> {
  const res = await fetch(`${integrationsBase()}/github/worker/index-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...input,
      worker_secret: config.workerInboundSecret,
    }),
  })
  if (!res.ok) {
    console.warn(`[github] index status patch failed: ${res.status}`)
  }
}
