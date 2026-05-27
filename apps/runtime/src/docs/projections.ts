import { createHash } from 'node:crypto'
import type { DocBlock } from './client.js'
import { blockEmbeddingText, inlineRunsToText } from './block-utils.js'

/** Normalize workspace block rows (block_type) to DocBlock shape. */
export function normalizeDocBlock(raw: Record<string, unknown>): DocBlock {
  const type = String(raw.type ?? raw.block_type ?? 'paragraph')
  return {
    id: String(raw.id),
    page_id: String(raw.page_id),
    parent_block_id: (raw.parent_block_id as string | null) ?? null,
    type,
    text: (raw.text as DocBlock['text']) ?? null,
    props: (raw.props as Record<string, unknown> | null) ?? null,
    position: Number(raw.position ?? 0),
  }
}

export function normalizeDocBlocks(rawBlocks: unknown[]): DocBlock[] {
  return rawBlocks
    .filter((b): b is Record<string, unknown> => b != null && typeof b === 'object')
    .map(normalizeDocBlock)
    .filter((b) => !b.parent_block_id)
    .sort((a, b) => a.position - b.position)
}

export function blocksToMarkdown(blocks: DocBlock[]): string {
  const lines: string[] = []
  for (const block of blocks) {
    const text = inlineRunsToText(block.text)
    switch (block.type) {
      case 'heading_1':
        lines.push(`# ${text}`)
        break
      case 'heading_2':
        lines.push(`## ${text}`)
        break
      case 'heading_3':
        lines.push(`### ${text}`)
        break
      case 'bullet_list_item':
        lines.push(`- ${text}`)
        break
      case 'numbered_list_item':
        lines.push(`${block.position + 1}. ${text}`)
        break
      case 'quote':
        lines.push(`> ${text}`)
        break
      case 'callout':
        lines.push(`> ${text}`)
        break
      case 'code':
        lines.push('```')
        lines.push(text)
        lines.push('```')
        break
      case 'divider':
        lines.push('---')
        break
      case 'to_do': {
        const checked = (block.props as { checked?: boolean } | null)?.checked
        lines.push(`${checked ? '[x]' : '[ ]'} ${text}`)
        break
      }
      default:
        if (text.trim()) lines.push(text)
    }
  }
  return lines.join('\n\n').trim()
}

export function blocksToPlaintext(blocks: DocBlock[]): string {
  return blocks
    .map((block) => blockEmbeddingText(block))
    .filter(Boolean)
    .join('\n\n')
    .trim()
}

export function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function summaryRelevantBlockTypes(): Set<string> {
  return new Set([
    'heading_1',
    'heading_2',
    'heading_3',
    'paragraph',
    'callout',
    'bullet_list_item',
    'numbered_list_item',
  ])
}

export function blocksNeedSummaryRefresh(changedBlocks: DocBlock[]): boolean {
  return changedBlocks.some((b) => summaryRelevantBlockTypes().has(b.type))
}
