import { workbenchRoutes } from '../api/routes'
import { apiDelete, apiGet, apiPost } from './api'

export type WorkbenchBackendProvider = 'cursor' | 'claude_managed' | 'devin'

export type WorkbenchConnection = {
  id: string
  provider: string
  label: string
  display_name: string
  status: string
  has_credentials: boolean
  metadata: Record<string, unknown>
  created_at: string | null
}

export type WorkbenchCatalogRow = {
  provider: string
  label: string
  phase: number
  connectable: boolean
  capabilities: Record<string, boolean>
  api_version: string
}

const UI_TO_BACKEND: Record<string, WorkbenchBackendProvider> = {
  cursorAgents: 'cursor',
  claudeManaged: 'claude_managed',
  devin: 'devin',
}

export function workbenchBackendId(uiId: string): WorkbenchBackendProvider | null {
  return UI_TO_BACKEND[uiId] ?? null
}

export async function listWorkbenchConnections(token: string): Promise<WorkbenchConnection[]> {
  const data = await apiGet<{ connections: WorkbenchConnection[] }>(
    workbenchRoutes.connections,
    token,
  )
  return data.connections ?? []
}

export async function listWorkbenchCatalog(token: string): Promise<WorkbenchCatalogRow[]> {
  const data = await apiGet<{ providers: WorkbenchCatalogRow[] }>(workbenchRoutes.catalog, token)
  return data.providers ?? []
}

export async function connectWorkbenchProvider(
  token: string,
  input: {
    provider: WorkbenchBackendProvider
    api_key: string
    display_name?: string
    org_id?: string
    default_model?: string
    git_token?: string
  },
): Promise<WorkbenchConnection> {
  const data = await apiPost<{ connection: WorkbenchConnection }>(
    workbenchRoutes.connections,
    input,
    token,
  )
  return data.connection
}

export async function disconnectWorkbenchProvider(token: string, connectionId: string): Promise<void> {
  await apiDelete(workbenchRoutes.connection(connectionId), token)
}

export async function followUpWorkbenchJob(
  token: string,
  jobId: string,
  text: string,
): Promise<void> {
  await apiPost(workbenchRoutes.jobFollowUp(jobId), { text }, token)
}

export async function cancelWorkbenchJob(token: string, jobId: string): Promise<void> {
  await apiPost(workbenchRoutes.jobCancel(jobId), {}, token)
}
