import { workspaceRoutes } from '../api/routes'
import {
  workforceDelete,
  workforceGet,
  workforcePatch,
  workforcePost,
} from './api'

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
  const res = await workforceGet<{ docs: WorkspaceDocRow[] }>(workspaceRoutes.docs(kind))
  return res.docs
}

export async function getWorkspaceDoc(docId: string): Promise<WorkspaceDocRow> {
  return workforceGet<WorkspaceDocRow>(workspaceRoutes.doc(docId))
}

export async function createWorkspaceDoc(input: {
  path: string
  content?: string
  kind?: WorkspaceDocKind
  title?: string
}): Promise<WorkspaceDocRow> {
  return workforcePost<WorkspaceDocRow>(workspaceRoutes.docs(), input)
}

export async function updateWorkspaceDoc(
  docId: string,
  patch: { content?: string; kind?: WorkspaceDocKind; title?: string; is_pinned?: boolean },
): Promise<WorkspaceDocRow> {
  return workforcePatch<WorkspaceDocRow>(workspaceRoutes.doc(docId), patch)
}

export async function deleteWorkspaceDoc(docId: string): Promise<void> {
  await workforceDelete(workspaceRoutes.doc(docId))
}

export async function searchWorkspace(query: string, topK = 8): Promise<WorkspaceSearchHit[]> {
  const res = await workforcePost<{ results: WorkspaceSearchHit[] }>(workspaceRoutes.search(), {
    query,
    top_k: topK,
  })
  return res.results
}
