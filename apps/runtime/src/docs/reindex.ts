import { config } from '../config.js'
import { embedDocumentText, processIndexJob } from '../indexing.js'
import { fetchPageForReindex, type DocBlock } from './client.js'
import { blockEmbeddingText, inlineRunsToText, pageSummaryText } from './block-utils.js'
import {
  blocksNeedSummaryRefresh,
  blocksToMarkdown,
  blocksToPlaintext,
  contentHash,
  normalizeDocBlocks,
} from './projections.js'
import {
  fetchWorkspacePageForReindex,
  patchWorkspacePageProjections,
} from './workspace-client.js'

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

async function indexProjectBlocksDelta(input: {
  tenant_id: string
  project_id: string
  pageSlug: string
  blocks: DocBlock[]
  changed_block_ids?: string[]
}): Promise<number> {
  const changedSet = input.changed_block_ids?.length
    ? new Set(input.changed_block_ids)
    : null
  let chunks = 0

  for (const block of input.blocks) {
    if (changedSet && !changedSet.has(block.id)) continue
    const text = blockEmbeddingText(block)
    if (!text.trim()) continue
    await processIndexJob({
      project_id: input.project_id,
      tenant_id: input.tenant_id,
      file_path: `${input.pageSlug}#${block.id}`,
      content: text,
      source_type: 'doc_block',
    })
    chunks += 1
  }
  return chunks
}

/**
 * Reindex a single project doc page. Fetches the page's blocks via the
 * worker endpoint, embeds changed blocks (and a page-level summary chunk),
 * and upserts into index_chunks with source_type=doc_block /
 * source_type=doc_page_summary.
 */
export async function processDocPageReindex(input: {
  tenant_id: string
  project_id: string
  page_id: string
  changed_block_ids?: string[]
}): Promise<{ chunks: number }> {
  const payload = await fetchPageForReindex(input.tenant_id, input.project_id, input.page_id)
  if (!payload) return { chunks: 0 }

  const { page, blocks } = payload
  const flatBlocks = blocks.filter((b) => !b.parent_block_id)
  let chunks = await indexProjectBlocksDelta({
    tenant_id: input.tenant_id,
    project_id: input.project_id,
    pageSlug: page.slug,
    blocks: flatBlocks,
    changed_block_ids: input.changed_block_ids,
  })

  const changedBlocks = input.changed_block_ids?.length
    ? flatBlocks.filter((b) => input.changed_block_ids!.includes(b.id))
    : flatBlocks
  const refreshSummary =
    !input.changed_block_ids?.length || blocksNeedSummaryRefresh(changedBlocks)

  if (refreshSummary) {
    const summary = pageSummaryText(page, flatBlocks)
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
  }

  return { chunks }
}

/**
 * Reindex a workspace doc page using derived plaintext projections as the
 * primary index source. Skips when content_hash is unchanged.
 */
export async function processWorkspaceDocPageReindex(input: {
  tenant_id: string
  workspace_doc_id: string
  page_id: string
  changed_block_ids?: string[]
}): Promise<{ chunks: number }> {
  const payload = await fetchWorkspacePageForReindex(
    input.tenant_id,
    input.workspace_doc_id,
    input.page_id,
  )
  if (!payload) return { chunks: 0 }

  const { page } = payload
  const blocks = normalizeDocBlocks(payload.blocks as unknown[])
  const markdown = blocksToMarkdown(blocks)
  const plaintext = blocksToPlaintext(blocks)
  const hash = contentHash(plaintext)

  if (page.content_hash && page.content_hash === hash) {
    return { chunks: 0 }
  }

  let chunks = 0
  if (plaintext.trim()) {
    const result = await processIndexJob({
      workspace_doc_id: input.workspace_doc_id,
      tenant_id: input.tenant_id,
      file_path: `${page.slug}#__plaintext__`,
      content: plaintext,
      source_type: 'workspace_doc_page',
    })
    chunks += result.chunks
  }

  const changedBlocks = input.changed_block_ids?.length
    ? blocks.filter((b) => input.changed_block_ids!.includes(b.id))
    : blocks
  const refreshSummary =
    !input.changed_block_ids?.length || blocksNeedSummaryRefresh(changedBlocks)

  if (refreshSummary) {
    const summary = pageSummaryText(page, blocks)
    if (summary.trim()) {
      const result = await processIndexJob({
        workspace_doc_id: input.workspace_doc_id,
        tenant_id: input.tenant_id,
        file_path: `${page.slug}#__summary__`,
        content: summary,
        source_type: 'workspace_doc_page_summary',
      })
      chunks += result.chunks
    }
  }

  await patchWorkspacePageProjections({
    tenantId: input.tenant_id,
    pageId: input.page_id,
    renderedMarkdown: markdown,
    renderedPlaintext: plaintext,
    contentHash: hash,
  })

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

export function formatWorkspaceDocMap(
  pages: Array<{ slug: string; kind: string; title: string }>,
  blocksByPage: Map<string, Array<{ type: string; text: Array<{ text?: string }> | null }>>,
): string {
  const lines: string[] = ['Workspace documentation map (read this before writing anything):']
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
