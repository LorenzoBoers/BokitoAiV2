import { workspaceDocRoutes } from '../api/routes'
import {
  xanoDeleteWorkforce,
  xanoGetWorkforce,
  xanoPatchWorkforce,
  xanoPostWorkforce,
} from './xano'
import type {
  BlockOp,
  DocBlockRevisionRow,
  DocBlockRow,
  DocChangeRequestRow,
  DocPageBlocksResponse,
  DocPageKind,
  DocPageRow,
  DocRoot,
  DocTreeResponse,
  InlineRun,
} from './doc-api'

export type {
  BlockOp,
  DocBlockRevisionRow,
  DocBlockRow,
  DocChangeRequestRow,
  DocPageBlocksResponse,
  DocPageKind,
  DocPageRow,
  DocRoot,
  InlineRun,
}

function normalizeDocTreeResponse(
  raw: DocTreeResponse & { doc?: unknown; workspace_doc?: unknown },
): DocTreeResponse {
  const root = raw.workspace_doc ?? raw.doc
  if (root == null || typeof root !== 'object' || !('id' in (root as object))) {
    throw new Error('Workspace document root ontbreekt in API response.')
  }
  const doc = root as DocRoot
  const pages = Array.isArray(raw.pages) ? raw.pages : []
  return { doc, pages }
}

export async function getWorkspaceDoc(): Promise<DocTreeResponse> {
  const raw = await xanoGetWorkforce<DocTreeResponse & { doc?: unknown }>(workspaceDocRoutes.tree())
  return normalizeDocTreeResponse(raw)
}

function normalizeWorkspaceBlockRow(raw: Record<string, unknown>): DocBlockRow {
  const blockType = (raw.block_type ?? raw.type) as DocBlockRow['type']
  return { ...(raw as unknown as DocBlockRow), type: blockType }
}

export async function listWorkspacePageBlocks(pageId: string): Promise<DocPageBlocksResponse> {
  const raw = await xanoGetWorkforce<DocPageBlocksResponse & { blocks?: unknown }>(
    workspaceDocRoutes.blocks(pageId),
  )
  const blocks = Array.isArray(raw.blocks)
    ? raw.blocks.map((b) => normalizeWorkspaceBlockRow(b as unknown as Record<string, unknown>))
    : []
  return { page: raw.page, blocks }
}

export async function applyWorkspaceBlockOps(
  pageId: string,
  ops: BlockOp[],
  options?: {
    actorLabel?: string
    expectedVersion?: number
  },
): Promise<{ applied: DocBlockRow[]; page_id: string; content_version?: number }> {
  return xanoPostWorkforce(workspaceDocRoutes.blocks(pageId), {
    ops,
    actor_label: options?.actorLabel,
    expected_version: options?.expectedVersion,
  })
}

export class WorkspaceDocVersionConflictError extends Error {
  constructor(message = 'Content version conflict. Reload the page and retry.') {
    super(message)
    this.name = 'WorkspaceDocVersionConflictError'
  }
}

export function isWorkspaceDocVersionConflict(err: unknown): boolean {
  if (err instanceof WorkspaceDocVersionConflictError) return true
  const message = err instanceof Error ? err.message : String(err)
  return /content version conflict/i.test(message)
}

export async function listWorkspaceBlockRevisions(
  pageId: string,
  blockId?: string,
): Promise<DocBlockRevisionRow[]> {
  return xanoGetWorkforce<DocBlockRevisionRow[]>(
    workspaceDocRoutes.revisions(pageId, blockId),
  )
}

export async function createWorkspaceDocPage(input: {
  workspace_doc_id: string
  title: string
  slug: string
  kind?: DocPageKind
  icon?: string
  parent_page_id?: string | null
}): Promise<DocPageRow> {
  return xanoPostWorkforce<DocPageRow>(workspaceDocRoutes.pages(), input)
}

export async function patchWorkspaceDocPage(
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
  return xanoPatchWorkforce<DocPageRow>(workspaceDocRoutes.page(pageId), patch)
}

export async function deleteWorkspaceDocPage(pageId: string): Promise<void> {
  await xanoDeleteWorkforce(workspaceDocRoutes.page(pageId))
}

export async function migrateWorkspaceDocFromProject(
  projectId: string,
): Promise<{ ok: boolean; pages_copied: number }> {
  return xanoPostWorkforce(workspaceDocRoutes.migrateFromProject(), { project_id: projectId })
}

export async function createWorkspaceDocChangeRequest(input: {
  body: string
  title?: string
  target_page_id?: string
  priority?: number
}): Promise<DocChangeRequestRow> {
  return xanoPostWorkforce<DocChangeRequestRow>(workspaceDocRoutes.changeRequests(), input)
}
