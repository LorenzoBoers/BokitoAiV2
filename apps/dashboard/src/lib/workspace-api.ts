import { workspaceRoutes } from '../api/routes'
import { APP_API_BASE } from './api.config'
import { apiDelete, apiGet, apiPatch, apiPost, requireAccessToken } from './api'

export type WorkspaceDocKind = 'doc' | 'memory' | 'persona' | 'skill' | 'daily_log' | 'heartbeat'

export interface WorkspaceDocRow {
  id: string
  path: string
  kind: WorkspaceDocKind
  title: string
  frontmatter: Record<string, string>
  is_pinned: boolean
  sort_order: number
  created_by_type: 'user' | 'agent' | 'system'
  created_at: string
  updated_at: string
  content?: string
}

export interface WorkspaceSearchHit {
  source_type: string
  source_id: string
  doc_id: string | null
  title: string
  content: string
  score: number
}

export async function listWorkspaceDocs(kind?: string): Promise<WorkspaceDocRow[]> {
  const res = await apiGet<{ docs: WorkspaceDocRow[] }>(workspaceRoutes.docs(kind))
  return res.docs
}

export async function getWorkspaceDoc(docId: string): Promise<WorkspaceDocRow> {
  return apiGet<WorkspaceDocRow>(workspaceRoutes.doc(docId))
}

export async function createWorkspaceDoc(input: {
  path: string
  content?: string
  kind?: WorkspaceDocKind
  title?: string
}): Promise<WorkspaceDocRow> {
  return apiPost<WorkspaceDocRow>(workspaceRoutes.docs(), input)
}

export async function updateWorkspaceDoc(
  docId: string,
  patch: { content?: string; kind?: WorkspaceDocKind; title?: string; is_pinned?: boolean },
): Promise<WorkspaceDocRow> {
  return apiPatch<WorkspaceDocRow>(workspaceRoutes.doc(docId), patch)
}

export async function deleteWorkspaceDoc(docId: string): Promise<void> {
  await apiDelete(workspaceRoutes.doc(docId))
}

/** Publish or unpublish a doc on the tenant's public help center. */
export async function publishWorkspaceDoc(
  docId: string,
  published: boolean,
): Promise<WorkspaceDocRow> {
  return apiPost<WorkspaceDocRow>(workspaceRoutes.docPublish(docId), { published })
}

/** Ingest a document file (PDF, Word, text, markdown) into the knowledge base.
 * The backend extracts text and indexes it for agent retrieval. */
export async function uploadWorkspaceDocument(file: File): Promise<WorkspaceDocRow> {
  const token = requireAccessToken()
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${APP_API_BASE}${workspaceRoutes.docsUpload()}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = ((await res.json()) as { detail?: string }).detail ?? ''
    } catch {
      // Non-JSON error body; fall back to the status code below.
    }
    throw new Error(detail || `Upload failed (HTTP ${res.status})`)
  }
  return (await res.json()) as WorkspaceDocRow
}

export async function searchWorkspace(query: string, topK = 8): Promise<WorkspaceSearchHit[]> {
  const res = await apiPost<{ results: WorkspaceSearchHit[] }>(workspaceRoutes.search(), {
    query,
    top_k: topK,
  })
  return res.results
}
