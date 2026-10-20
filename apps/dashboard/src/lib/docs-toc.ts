/**
 * Table-of-contents extraction for product-help articles. The id scheme is
 * shared with MarkdownView so ToC links anchor to rendered headings.
 */

export interface TocItem {
  id: string
  text: string
  level: 2 | 3
}

/** Strip inline markdown (bold, code, links, icon marks) from a heading line. */
export function headingText(raw: string): string {
  return raw
    .replace(/\{icon:[a-z0-9-]+\}\s*/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim()
}

/** Stable anchor id for a heading, shared by MarkdownView and the ToC. */
export function headingId(raw: string): string {
  return headingText(raw)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-')
}

/** All `##` and `###` headings in document order, skipping fenced code blocks. */
export function extractToc(content: string): TocItem[] {
  const items: TocItem[] = []
  let inFence = false
  for (const line of content.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = line.match(/^(#{2,3})\s+(.+)$/)
    if (match) {
      const level = match[1].length === 2 ? 2 : 3
      items.push({ id: headingId(match[2]), text: headingText(match[2]), level })
    }
  }
  return items
}
