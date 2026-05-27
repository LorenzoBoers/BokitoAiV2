import { githubRoutes, integrationsRoutes } from '../api/routes'
import { xanoDeleteIntegrations, xanoGetIntegrations } from './xano'
import {
  listIntegrationConnections,
  revokeIntegrationConnection,
} from './integrations-api'

export interface GithubConnectionRow {
  id: string
  github_login: string
  display_name?: string
  status: 'active' | 'revoked' | 'error'
  connected_at?: string
  created_at?: string
}

export interface GithubRepoRow {
  id: number
  full_name: string
  default_branch?: string
  private?: boolean
}

export async function startGithubOAuth(returnUrl: string, projectId?: string): Promise<{ authorize_url: string }> {
  return xanoGetIntegrations<{ authorize_url: string }>(
    githubRoutes.oauth.start(returnUrl, projectId),
  )
}

function normalizeGithubConnectionRow(
  row: GithubConnectionRow | Record<string, unknown>,
): GithubConnectionRow | null {
  if (!row || typeof row !== 'object') return null
  const id = typeof row.id === 'string' ? row.id : null
  const github_login =
    typeof row.github_login === 'string'
      ? row.github_login
      : typeof (row as { login?: string }).login === 'string'
        ? (row as { login: string }).login
        : null
  if (!id || !github_login) return null
  const status = row.status
  return {
    id,
    github_login,
    display_name: typeof row.display_name === 'string' ? row.display_name : undefined,
    status:
      status === 'active' || status === 'revoked' || status === 'error' ? status : 'active',
    connected_at: typeof row.connected_at === 'string' ? row.connected_at : undefined,
    created_at: typeof row.created_at === 'string' ? row.created_at : undefined,
  }
}

/** GET /github/connection — must not call listGithubConnections (avoids recursion). */
async function fetchGithubConnectionSingular(): Promise<GithubConnectionRow | null> {
  try {
    const data = await xanoGetIntegrations<
      GithubConnectionRow | { connection: GithubConnectionRow | null }
    >(githubRoutes.connection)
    if (data && typeof data === 'object' && 'connection' in data) {
      const nested = (data as { connection: GithubConnectionRow | null }).connection
      return nested ? normalizeGithubConnectionRow(nested) : null
    }
    return normalizeGithubConnectionRow(data as GithubConnectionRow)
  } catch {
    return null
  }
}

export async function listGithubConnections(): Promise<GithubConnectionRow[]> {
  try {
    const data = await xanoGetIntegrations<{ connections: GithubConnectionRow[] }>(githubRoutes.connections)
    if (data.connections?.length) return data.connections
  } catch {
    // fall through
  }

  try {
    const ic = await listIntegrationConnections('github')
    if (ic.length > 0) {
      return ic.map((c) => ({
        id: c.id,
        github_login: (c.metadata?.github_login as string) || c.display_name,
        display_name: c.display_name,
        status: c.status,
        connected_at: c.created_at,
        created_at: c.created_at,
      }))
    }
  } catch {
    // fall through
  }

  const single = await fetchGithubConnectionSingular()
  return single ? [single] : []
}

export async function getGithubConnection(): Promise<GithubConnectionRow | null> {
  const list = await listGithubConnections()
  return list[0] ?? null
}

export async function disconnectGithubConnection(connectionId?: string): Promise<void> {
  if (connectionId) {
    await revokeIntegrationConnection(connectionId)
    return
  }
  const list = await listGithubConnections()
  if (list[0]?.id) {
    await revokeIntegrationConnection(list[0].id)
    return
  }
  await xanoDeleteIntegrations(githubRoutes.connection)
}

export async function listGithubRepos(connectionId?: string): Promise<GithubRepoRow[]> {
  const path = githubRoutes.repos(connectionId)
  try {
    const data = await xanoGetIntegrations<GithubRepoRow[] | { items: GithubRepoRow[] }>(path)
    return Array.isArray(data) ? data : data.items ?? []
  } catch {
    if (connectionId) {
      const res = await xanoGetIntegrations<{ items: GithubRepoRow[] }>(
        integrationsRoutes.platform.connectionResources(connectionId),
      )
      const items = (res as { items?: GithubRepoRow[] }).items
      return items ?? []
    }
    throw new Error('Could not load repositories')
  }
}

export async function listGithubBranches(
  owner: string,
  repo: string,
  connectionId?: string,
): Promise<string[]> {
  const data = await xanoGetIntegrations<string[] | { branches: string[] }>(
    githubRoutes.branches(owner, repo, connectionId),
  )
  if (Array.isArray(data)) return data
  return data.branches ?? []
}
