// Conversation-driven project work: implementation queue, smart-doc sections,
// and generic project resources (repo / drive / notion / vibecode slots).
import { projectsRoutes } from '../api/routes'
import { workforceDelete, workforceGet, workforcePatch, workforcePost } from './api'

export type QueueItemKind = 'feature' | 'bug' | 'task' | 'idea' | 'risk'
export type QueueItemPriority = 'low' | 'normal' | 'high' | 'urgent'
export type QueueItemStatus =
  | 'proposed'
  | 'queued'
  | 'analyzing'
  | 'planned'
  | 'running'
  | 'verifying'
  | 'completed'
  | 'rejected'

// Section maturity: draft (concept) -> review (written) -> final (verified).
export type DocSectionStatus = 'draft' | 'review' | 'final'

export type ResourceType = 'repo' | 'drive' | 'notion' | 'sheet' | 'vibecode' | 'site' | 'other'
export type ResourceStatus = 'linked' | 'connected' | 'syncing' | 'error' | 'disconnected'

export interface QueueItemLink {
  id: string
  section_id: string | null
  doc_id: string | null
  doc_title?: string | null
  anchor: string | null
  heading: string | null
  section_status: DocSectionStatus | null
  relation: string
  created_by_type: string
  created_at: string | null
}

export interface QueueItemRow {
  id: string
  project_id: string
  kind: QueueItemKind
  title: string
  body: string
  priority: QueueItemPriority
  status: QueueItemStatus
  duplicate_of_id: string | null
  origin_type: string
  signal_id: string | null
  message_id: string | null
  created_by_type: string
  created_by_id: string
  impact_summary: string
  analyzed_at: string | null
  assigned_agent_id: string | null
  links: QueueItemLink[]
  created_at: string | null
  updated_at: string | null
}

export interface DocSectionItemRef {
  queue_item_id: string
  title: string
  kind: QueueItemKind
  status: QueueItemStatus
  relation: string
  created_at: string | null
}

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
  items?: DocSectionItemRef[]
}

export interface LinkedRequestRef {
  id: string
  title: string
  status: QueueItemStatus
  kind: QueueItemKind
  project_id: string | null
  relation?: string
}

export interface ProjectDocRow {
  id: string
  path: string
  kind: string
  project_id: string | null
  title: string
  content?: string
  updated_at: string
  sections: DocSectionRow[]
  linked_requests?: LinkedRequestRef[]
}

export interface ProjectResourceRow {
  id: string
  project_id: string
  resource_type: ResourceType
  provider: string
  connection_id: string | null
  label: string
  external_ref: string
  config: Record<string, unknown>
  status: ResourceStatus
  sync_status: string | null
  synced_at: string | null
  sync_error: string | null
  sync_ref: string | null
  created_at: string | null
  updated_at: string | null
}

// ── queue ────────────────────────────────────────────────────────

export async function listQueueItems(
  projectId: string,
  params?: { status?: QueueItemStatus; kind?: QueueItemKind },
): Promise<QueueItemRow[]> {
  const data = await workforceGet<{ items: QueueItemRow[] }>(projectsRoutes.queue(projectId, params))
  return data.items ?? []
}

export async function createQueueItem(
  projectId: string,
  input: {
    title: string
    kind?: QueueItemKind
    body?: string
    priority?: QueueItemPriority
    /** Link the queue task to the signal (thread) it originates from. */
    signal_id?: string
  },
): Promise<QueueItemRow> {
  return workforcePost<QueueItemRow>(projectsRoutes.queue(projectId), input)
}

export async function patchQueueItem(
  projectId: string,
  itemId: string,
  patch: {
    title?: string
    body?: string
    kind?: QueueItemKind
    priority?: QueueItemPriority
    status?: QueueItemStatus
    impact_summary?: string
  },
): Promise<QueueItemRow> {
  return workforcePatch<QueueItemRow>(projectsRoutes.queueItem(projectId, itemId), patch)
}

export async function analyzeQueueItem(
  projectId: string,
  itemId: string,
): Promise<{ started: boolean; task_id?: string }> {
  return workforcePost(projectsRoutes.queueItemAnalyze(projectId, itemId), {})
}

export async function verifyQueueItem(
  projectId: string,
  itemId: string,
): Promise<{ started: boolean; task_id?: string }> {
  return workforcePost(projectsRoutes.queueItemVerify(projectId, itemId), {})
}

// ── docs ─────────────────────────────────────────────────────────

export async function listProjectDocs(projectId: string): Promise<ProjectDocRow[]> {
  const data = await workforceGet<{ docs: ProjectDocRow[] }>(projectsRoutes.docs(projectId))
  return data.docs ?? []
}

export async function saveProjectDoc(
  projectId: string,
  input: { path: string; content: string; title?: string },
): Promise<ProjectDocRow> {
  return workforcePost<ProjectDocRow>(projectsRoutes.docs(projectId), input)
}

export async function linkQueueItemToDoc(
  projectId: string,
  docId: string,
  queueItemId: string,
  relation: string = 'touches',
): Promise<{ id: string; doc_id: string | null; relation: string }> {
  return workforcePost(projectsRoutes.docLinks(projectId, docId), {
    queue_item_id: queueItemId,
    relation,
  })
}

export async function setSectionStatus(
  projectId: string,
  docId: string,
  sectionId: string,
  status: DocSectionStatus,
  summary?: string,
): Promise<DocSectionRow> {
  return workforcePatch<DocSectionRow>(projectsRoutes.docSection(projectId, docId, sectionId), {
    status,
    summary,
  })
}

// ── resources ────────────────────────────────────────────────────

export async function listProjectResources(projectId: string): Promise<ProjectResourceRow[]> {
  const data = await workforceGet<{ items: ProjectResourceRow[] }>(projectsRoutes.resources(projectId))
  return data.items ?? []
}

export async function createProjectResource(
  projectId: string,
  input: {
    resource_type: ResourceType
    provider?: string
    label?: string
    external_ref?: string
    config?: Record<string, unknown>
  },
): Promise<ProjectResourceRow> {
  return workforcePost<ProjectResourceRow>(projectsRoutes.resources(projectId), input)
}

export async function deleteProjectResource(projectId: string, resourceId: string): Promise<void> {
  await workforceDelete(projectsRoutes.resourceById(projectId, resourceId))
}
