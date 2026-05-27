import { processDocPageReindex, processWorkspaceDocPageReindex } from './reindex.js'

const COALESCE_MS = 15_000

type ProjectReindexInput = {
  scope: 'project'
  tenant_id: string
  project_id: string
  page_id: string
  changed_block_ids?: string[]
}

type WorkspaceReindexInput = {
  scope: 'workspace'
  tenant_id: string
  workspace_doc_id: string
  page_id: string
  changed_block_ids?: string[]
}

export type DocReindexInput = ProjectReindexInput | WorkspaceReindexInput

interface PendingEntry {
  timer: ReturnType<typeof setTimeout>
  input: DocReindexInput
  changedBlockIds: Set<string>
}

const pending = new Map<string, PendingEntry>()

function reindexKey(input: DocReindexInput): string {
  return `${input.scope}:${input.page_id}`
}

function mergeChangedBlockIds(existing: Set<string>, next?: string[]): Set<string> {
  const merged = new Set(existing)
  for (const id of next ?? []) merged.add(id)
  return merged
}

async function runReindex(input: DocReindexInput, changedBlockIds: Set<string>): Promise<void> {
  const changedIds = changedBlockIds.size ? [...changedBlockIds] : undefined
  if (input.scope === 'workspace') {
    await processWorkspaceDocPageReindex({
      tenant_id: input.tenant_id,
      workspace_doc_id: input.workspace_doc_id,
      page_id: input.page_id,
      changed_block_ids: changedIds,
    })
    return
  }
  await processDocPageReindex({
    tenant_id: input.tenant_id,
    project_id: input.project_id,
    page_id: input.page_id,
    changed_block_ids: changedIds,
  })
}

/**
 * Coalesce rapid page reindex requests so burst edits produce one indexing run.
 */
export function scheduleDocPageReindex(input: DocReindexInput): void {
  const key = reindexKey(input)
  const existing = pending.get(key)
  if (existing) {
    clearTimeout(existing.timer)
    existing.input = input
    existing.changedBlockIds = mergeChangedBlockIds(existing.changedBlockIds, input.changed_block_ids)
    existing.timer = setTimeout(() => {
      pending.delete(key)
      void runReindex(existing.input, existing.changedBlockIds).catch((err) => {
        console.error('[doc/reindex-coalesce]', key, err)
      })
    }, COALESCE_MS)
    pending.set(key, existing)
    return
  }

  const changedBlockIds = mergeChangedBlockIds(new Set(), input.changed_block_ids)
  const timer = setTimeout(() => {
    pending.delete(key)
    void runReindex(input, changedBlockIds).catch((err) => {
      console.error('[doc/reindex-coalesce]', key, err)
    })
  }, COALESCE_MS)
  pending.set(key, { timer, input, changedBlockIds })
}

/** Flush pending reindex immediately (used in tests). */
export async function flushDocPageReindexForTests(): Promise<void> {
  const entries = [...pending.values()]
  pending.clear()
  for (const entry of entries) {
    clearTimeout(entry.timer)
    await runReindex(entry.input, entry.changedBlockIds)
  }
}
