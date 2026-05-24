import { config } from '../config.js'
import { embedDocumentText, processIndexJob } from '../indexing.js'
import { fetchPageForReindex } from './client.js'
import { blockEmbeddingText, inlineRunsToText, pageSummaryText } from './block-utils.js'

interface DocSectionRow {
  id: string
  doc_id: string
  content?: string
  title?: string
}

/**
 * Index tenant doc sections into unified index_chunks for a project scope.
 * Kept for backwards compatibility with the legacy tenant_docs flow.
 */
export async function processTenantDocsIndex(input: {
  tenant_id: string
  project_id: string
  doc_id: string
  sections: DocSectionRow[]
}): Promise<{ indexed: number }> {
  let indexed = 0
  for (const section of input.sections) {
    const text = [section.title, section.content].filter(Boolean).join('\n\n')
    if (!text.trim()) continue
    const sourceRef = `doc:${input.doc_id}:section:${section.id}`
    await processIndexJob({
      project_id: input.project_id,
      tenant_id: input.tenant_id,
      file_path: sourceRef,
      content: text,
      source_type: 'tenant_doc_section',
    })
    indexed += 1
  }
  return { indexed }
}

export async function fetchDocSectionsForProject(
  docId: string,
  authBearer: string,
): Promise<DocSectionRow[]> {
  const base = config.xanoBaseUrl?.replace(/\/api:.*$/, '') ?? config.xanoBaseUrl
  const url = `${base}/api:auth/docs/${docId}/sections`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${authBearer}` },
  })
  if (!res.ok) return []
  const data = (await res.json()) as DocSectionRow[] | { sections: DocSectionRow[] }
  return Array.isArray(data) ? data : data.sections ?? []
}

export async function embedDocQuery(query: string): Promise<number[]> {
  return embedDocumentText(query, 'search_query')
}

/**
 * Reindex a single project doc page. Fetches the page's blocks via the
 * worker endpoint, embeds each block (and a page-level summary chunk),
 * and upserts into index_chunks with source_type=doc_block /
 * source_type=doc_page_summary.
 */
export async function processDocPageReindex(input: {
  tenant_id: string
  project_id: string
  page_id: string
}): Promise<{ chunks: number }> {
  const payload = await fetchPageForReindex(input.tenant_id, input.project_id, input.page_id)
  if (!payload) return { chunks: 0 }

  const { page, blocks } = payload
  let chunks = 0

  for (const block of blocks) {
    const text = blockEmbeddingText(block)
    if (!text.trim()) continue
    await processIndexJob({
      project_id: input.project_id,
      tenant_id: input.tenant_id,
      file_path: `${page.slug}#${block.id}`,
      content: text,
      source_type: 'doc_block',
    })
    chunks += 1
  }

  const summary = pageSummaryText(page, blocks)
  if (summary.trim()) {
    await processIndexJob({
      project_id: input.project_id,
      tenant_id: input.tenant_id,
      file_path: `${page.slug}#__summary__`,
      content: summary,
      source_type: 'doc_page_summary',
    })
    chunks += 1
  }

  return { chunks }
}

/**
 * Build a compact "doc map" that an agent can read on every run: list of
 * pages with kind, title, and the headings on each page. Plain-text
 * format, not JSON, so it is cheap to inject into the system prompt.
 */
export function formatDocMap(
  pages: Array<{ slug: string; kind: string; title: string }>,
  blocksByPage: Map<string, Array<{ type: string; text: Array<{ text?: string }> | null }>>,
): string {
  const lines: string[] = ['Project documentation map (read this before writing anything):']
  for (const page of pages) {
    lines.push(`- [${page.kind}] ${page.title} (slug: ${page.slug})`)
    const blocks = blocksByPage.get(page.slug) ?? []
    const headings = blocks
      .filter(
        (b) => b.type === 'heading_1' || b.type === 'heading_2' || b.type === 'heading_3',
      )
      .map((b) => inlineRunsToText(b.text as Array<{ text?: string }> | null))
      .filter(Boolean)
    if (headings.length) {
      lines.push(`    sections: ${headings.join(' / ')}`)
    }
  }
  return lines.join('\n')
}
