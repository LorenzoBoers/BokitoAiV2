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
  const sanitizedOps = ops
    .map((op) => {
      if (op.op === 'create') {
        const next: BlockOp = {
          op: 'create',
          id: op.id,
          type: op.type,
          text: op.text ?? [],
          props: op.props ?? {},
          position: op.position,
        }
        if (op.parent_block_id) next.parent_block_id = op.parent_block_id
        return next
      }
      if (op.op === 'update') {
        if (!op.id) return null
        const next: BlockOp = { op: 'update', id: op.id }
        if (op.type != null) next.type = op.type
        if (op.text != null) next.text = op.text
        if (op.props != null) next.props = op.props
        return next
      }
      if (op.op === 'move') {
        if (!op.id) return null
        const next: BlockOp = { op: 'move', id: op.id, position: op.position }
        if (op.parent_block_id) next.parent_block_id = op.parent_block_id
        return next
      }
      if (op.op === 'delete') {
        if (!op.id) return null
        return { op: 'delete', id: op.id }
      }
      return op
    })
    .filter((op): op is BlockOp => op != null)

  const body: Record<string, unknown> = {
    ops: sanitizedOps,
  }
  if (options?.actorLabel) body.actor_label = options.actorLabel
  if (typeof options?.expectedVersion === 'number') {
    body.expected_version = options.expectedVersion
  }

  return xanoPostWorkforce(workspaceDocRoutes.blocks(pageId), body)
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
  position?: number
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
  const { is_locked, ...rest } = patch
  const body: Record<string, unknown> = { ...rest }
  if (is_locked === true) body.lock_action = 'lock'
  else if (is_locked === false) body.lock_action = 'unlock'
  return xanoPatchWorkforce<DocPageRow>(workspaceDocRoutes.page(pageId), body)
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
