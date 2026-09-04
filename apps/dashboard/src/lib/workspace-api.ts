import { apiDelete, apiGet, apiPatch, apiPost, requireAccessToken } from './api'
import { APP_API_BASE } from './api.config'
import { workspaceRoutes, type WorkspaceDocsQuery } from '../api/routes'

export type WorkspaceDocKind =
  | 'doc'
  | 'memory'
  | 'persona'
  | 'skill'
  | 'daily_log'
  | 'heartbeat'
  | 'project_doc'

export interface LinkedRequestRef {
  id: string
  title: string
  status: string
  kind: string
  project_id: string | null
  relation?: string
}

export type DocSectionStatus = 'draft' | 'review' | 'final'

export interface DocSectionRow {
  id: string
  doc_id: string
  anchor: string
  heading: string
  position: number
  content: string
  status: DocSectionStatus
  status_changed_at: string | null
  status_changed_by_type: string
  summary: string
  edited_by_type?: string
  updated_at: string | null
}

export interface WorkspaceDocRow {
  id: string
  path: string
  kind: WorkspaceDocKind
  project_id?: string | null
  agent_id?: string | null
  title: string
  frontmatter: Record<string, string>
  is_pinned: boolean
  sort_order: number
  created_by_type: 'user' | 'agent' | 'system'
  created_at: string
  updated_at: string
  content?: string
  sections?: DocSectionRow[]
  linked_requests?: LinkedRequestRef[]
}

export interface WorkspaceSearchHit {
  source_type: string
  source_id: string
  doc_id: string | null
  title: string
  content: string
  score: number
}

export async function listWorkspaceDocs(
  params?: WorkspaceDocsQuery | string,
): Promise<WorkspaceDocRow[]> {
  const res = await apiGet<{ docs: WorkspaceDocRow[] }>(workspaceRoutes.docs(params))
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
  project_id?: string
  agent_id?: string
}): Promise<WorkspaceDocRow> {
  return apiPost<WorkspaceDocRow>(workspaceRoutes.docs(), input)
}

export async function updateWorkspaceDoc(
  docId: string,
  patch: {
    content?: string
    kind?: WorkspaceDocKind
    title?: string
    is_pinned?: boolean
    project_id?: string | null
    agent_id?: string | null
  },
): Promise<WorkspaceDocRow> {
  return apiPatch<WorkspaceDocRow>(workspaceRoutes.doc(docId), patch)
}

export async function deleteWorkspaceDoc(docId: string): Promise<void> {
  await apiDelete(workspaceRoutes.doc(docId))
}

export async function createDocSection(
  docId: string,
  input: { heading: string; content?: string; summary?: string; position?: number },
): Promise<DocSectionRow> {
  return apiPost<DocSectionRow>(workspaceRoutes.docSections(docId), input)
}

export async function updateDocSection(
  docId: string,
  sectionId: string,
  patch: {
    heading?: string
    content?: string
    status?: DocSectionStatus
    summary?: string
    position?: number
  },
): Promise<DocSectionRow> {
  return apiPatch<DocSectionRow>(workspaceRoutes.docSection(docId, sectionId), patch)
}

export async function deleteDocSection(docId: string, sectionId: string): Promise<void> {
  await apiDelete(workspaceRoutes.docSection(docId, sectionId))
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
