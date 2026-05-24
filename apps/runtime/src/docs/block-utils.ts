import type { DocBlock } from './client.js'

/**
 * Extract plain text from inline runs.
 */
export function inlineRunsToText(runs: DocBlock['text']): string {
  if (!runs || !Array.isArray(runs)) return ''
  return runs.map((r) => r?.text ?? '').join('')
}

/**
 * Build embedding text for a single block. Uses block type as a soft prefix
 * so the embedding picks up structural cues (e.g. headings).
 */
export function blockEmbeddingText(block: DocBlock): string {
  const text = inlineRunsToText(block.text)
  if (!text.trim()) return ''
  switch (block.type) {
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
      return `# ${text}`
    case 'callout':
      return `> ${text}`
    case 'quote':
      return `"${text}"`
    case 'code':
      return text
    case 'to_do': {
      const checked = (block.props as { checked?: boolean } | null)?.checked
      return `${checked ? '[x]' : '[ ]'} ${text}`
    }
    case 'bullet_list_item':
      return `- ${text}`
    case 'numbered_list_item':
      return `${block.position + 1}. ${text}`
    default:
      return text
  }
}

/**
 * Build a per-page summary string used as the page-level summary chunk.
 * Concatenates headings + first paragraph for fast surface search.
 */
export function pageSummaryText(
  page: { title: string; kind: string },
  blocks: DocBlock[],
): string {
  const headings = blocks
    .filter((b) => b.type === 'heading_1' || b.type === 'heading_2' || b.type === 'heading_3')
    .map((b) => inlineRunsToText(b.text))
    .filter(Boolean)
  const firstParagraph = inlineRunsToText(
    blocks.find((b) => b.type === 'paragraph')?.text ?? null,
  )
  const lines = [`# ${page.title}`, `kind: ${page.kind}`]
  if (headings.length) lines.push(headings.join(' / '))
  if (firstParagraph) lines.push(firstParagraph.slice(0, 400))
  return lines.join('\n')
}
