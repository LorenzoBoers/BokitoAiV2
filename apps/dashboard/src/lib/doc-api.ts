import { docRoutes } from '../api/routes'
import {
  xanoDeleteWorkforce,
  xanoGetWorkforce,
  xanoPatchWorkforce,
  xanoPostWorkforce,
} from './xano'

export type DocPageKind =
  | 'overview'
  | 'vision'
  | 'features'
  | 'brand'
  | 'tech'
  | 'marketing'
  | 'operations'
  | 'roadmap'
  | 'log'
  | 'notes'
  | 'custom'

export type DocBlockType =
  | 'heading_1'
  | 'heading_2'
  | 'heading_3'
  | 'paragraph'
  | 'bullet_list_item'
  | 'numbered_list_item'
  | 'to_do'
  | 'quote'
  | 'callout'
  | 'divider'
  | 'code'
  | 'image'
  | 'embed'
  | 'link_to_page'
  | 'toggle'
  | 'table'

export interface InlineRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  code?: boolean
  color?: string
  link?: string
}

export interface DocPageRow {
  id: string
  tenant_id: string
  /** Present on project-scoped pages only. */
  project_id?: string
  /** Present on project-scoped pages only. */
  doc_id?: string
  /** Present on workspace-scoped pages. */
  workspace_doc_id?: string
  parent_page_id: string | null
  title: string
  slug: string
  icon: string | null
  kind: DocPageKind
  is_pinned: boolean
  is_locked: boolean
  position: number
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface DocBlockRow {
  id: string
  tenant_id: string
  project_id: string
  page_id: string
  parent_block_id: string | null
  type: DocBlockType
  text: InlineRun[]
  props: Record<string, unknown>
  position: number
  created_by_type: 'user' | 'agent'
  created_by_id: string | null
  last_edited_by_type: 'user' | 'agent'
  last_edited_by_id: string | null
  created_at: string
  updated_at: string
}

export interface DocRoot {
  id: string
  tenant_id: string
  project_id: string
  title: string
  created_at: string
  updated_at: string
}

export interface DocTreeResponse {
  doc: DocRoot
  pages: DocPageRow[]
}

export interface DocPageBlocksResponse {
  page: DocPageRow
  blocks: DocBlockRow[]
}

export interface DocBlockRevisionRow {
  id: string
  tenant_id: string
  project_id: string
  page_id: string
  block_id: string
  op: 'create' | 'update' | 'delete' | 'move'
  before: DocBlockRow | null
  after: DocBlockRow | null
  actor_type: 'user' | 'agent'
  actor_id: string | null
  actor_label: string
  change_note: string | null
  created_at: string
}

export interface DocChangeRequestRow {
  id: string
  tenant_id: string
  project_id: string
  target_page_id: string | null
  title: string | null
  body: string
  status: 'pending' | 'in_progress' | 'implemented' | 'blocked' | 'rejected'
  priority: number
  submitted_by_type: 'user' | 'agent'
  submitted_by_id: string | null
  linked_revision_ids: string[]
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export type BlockOp =
  | {
      op: 'create'
      id?: string
      parent_block_id?: string | null
      type: DocBlockType
      text?: InlineRun[]
      props?: Record<string, unknown>
      position?: number
      change_note?: string
    }
  | {
      op: 'update'
      id: string
      type?: DocBlockType
      text?: InlineRun[]
      props?: Record<string, unknown>
      change_note?: string
    }
  | {
      op: 'move'
      id: string
      parent_block_id?: string | null
      position: number
      change_note?: string
    }
  | {
      op: 'delete'
      id: string
      change_note?: string
    }

export async function getProjectDoc(projectId: string): Promise<DocTreeResponse> {
  return xanoGetWorkforce<DocTreeResponse>(docRoutes.tree(projectId))
}

export async function listPageBlocks(
  projectId: string,
  pageId: string,
): Promise<DocPageBlocksResponse> {
  return xanoGetWorkforce<DocPageBlocksResponse>(docRoutes.blocks(projectId, pageId))
}

export async function applyBlockOps(
  projectId: string,
  pageId: string,
  ops: BlockOp[],
  actorLabel?: string,
): Promise<{ applied: DocBlockRow[]; page_id: string }> {
  return xanoPostWorkforce(docRoutes.blocks(projectId, pageId), {
    ops,
    actor_label: actorLabel,
  })
}

export async function listBlockRevisions(
  projectId: string,
  pageId: string,
  blockId?: string,
): Promise<DocBlockRevisionRow[]> {
  return xanoGetWorkforce<DocBlockRevisionRow[]>(docRoutes.revisions(projectId, pageId, blockId))
}

export async function createDocPage(
  projectId: string,
  input: {
    title: string
    kind?: DocPageKind
    icon?: string
    parent_page_id?: string | null
  },
): Promise<DocPageRow> {
  return xanoPostWorkforce<DocPageRow>(docRoutes.pages(projectId), input)
}

export async function patchDocPage(
  projectId: string,
  pageId: string,
  patch: Partial<{
    title: string
    kind: DocPageKind
    icon: string
    parent_page_id: string | null
    position: number
    is_pinned: boolean
    is_locked: boolean
  }>,
): Promise<DocPageRow> {
  return xanoPatchWorkforce<DocPageRow>(docRoutes.page(projectId, pageId), patch)
}

export async function deleteDocPage(projectId: string, pageId: string): Promise<void> {
  await xanoDeleteWorkforce(docRoutes.page(projectId, pageId))
}

export async function listChangeRequests(
  projectId: string,
  status?: string,
): Promise<DocChangeRequestRow[]> {
  return xanoGetWorkforce<DocChangeRequestRow[]>(docRoutes.changeRequests(projectId, status))
}

export async function createChangeRequest(
  projectId: string,
  input: {
    body: string
    title?: string
    target_page_id?: string | null
    priority?: number
  },
): Promise<DocChangeRequestRow> {
  return xanoPostWorkforce<DocChangeRequestRow>(
    docRoutes.changeRequests(projectId),
    input,
  )
}
