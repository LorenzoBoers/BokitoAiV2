import type { BlockOp, DocBlockRow, InlineRun } from './doc-api'

export interface BlockNode {
  block: DocBlockRow
  children: BlockNode[]
}

/**
 * Build a parent-child tree from a flat list of blocks. Top-level blocks
 * (parent_block_id=null) become roots, others are nested under their parent.
 * Siblings are sorted by `position` then `created_at`.
 */
export function buildBlockTree(blocks: DocBlockRow[]): BlockNode[] {
  const byParent = new Map<string | null, DocBlockRow[]>()
  for (const block of blocks) {
    const key = block.parent_block_id ?? null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(block)
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => {
      if (a.position !== b.position) return a.position - b.position
      return (a.created_at ?? '').localeCompare(b.created_at ?? '')
    })
  }
  function build(parentId: string | null): BlockNode[] {
    return (byParent.get(parentId) ?? []).map((block) => ({
      block,
      children: build(block.id),
    }))
  }
  return build(null)
}

/**
 * Plain-text rendering of an inline-run array (used for previews,
 * read-only views, and embedding text).
 */
export function renderInlineText(runs: InlineRun[] | null | undefined): string {
  if (!runs || !Array.isArray(runs)) return ''
  return runs.map((r) => r?.text ?? '').join('')
}

/**
 * Diff a previous block list against the next one and return a minimal
 * BlockOp[] suitable for the batch endpoint. Used by the editor on
 * commit to send only what changed.
 */
export function diffBlockLists(
  prev: DocBlockRow[],
  next: Pick<
    DocBlockRow,
    'id' | 'parent_block_id' | 'type' | 'text' | 'props' | 'position'
  >[],
): BlockOp[] {
  const prevById = new Map(prev.map((b) => [b.id, b]))
  const nextIds = new Set(next.map((b) => b.id))
  const ops: BlockOp[] = []

  for (const block of next) {
    const before = prevById.get(block.id)
    if (!before) {
      ops.push({
        op: 'create',
        id: block.id,
        parent_block_id: block.parent_block_id,
        type: block.type,
        text: block.text,
        props: block.props,
        position: block.position,
      })
      continue
    }

    const moved =
      before.parent_block_id !== block.parent_block_id || before.position !== block.position
    const changed =
      before.type !== block.type ||
      JSON.stringify(before.text ?? []) !== JSON.stringify(block.text ?? []) ||
      JSON.stringify(before.props ?? {}) !== JSON.stringify(block.props ?? {})

    if (changed) {
      ops.push({
        op: 'update',
        id: block.id,
        type: block.type,
        text: block.text,
        props: block.props,
      })
    }
    if (moved) {
      ops.push({
        op: 'move',
        id: block.id,
        parent_block_id: block.parent_block_id,
        position: block.position,
      })
    }
  }

  for (const block of prev) {
    if (!nextIds.has(block.id)) {
      ops.push({ op: 'delete', id: block.id })
    }
  }

  return ops
}

/**
 * Stable sentinel used when generating a fresh block id on the client.
 * Uses crypto.randomUUID where available; falls back to time-based uuid.
 */
export function newBlockId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const rand = Math.random().toString(16).slice(2)
  return `${Date.now().toString(16)}-${rand.slice(0, 12)}`
}
