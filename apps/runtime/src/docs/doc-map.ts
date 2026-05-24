import { config } from '../config.js'
import { fetchPageForReindex, type DocBlock } from './client.js'
import { formatDocMap } from './reindex.js'

const integrationsBase = () => {
  const base = config.xanoBaseUrl
  if (!base) return ''
  return `${base}/api:integrations`
}

interface DocPageMin {
  id: string
  title: string
  slug: string
  kind: string
}

async function fetchDocTree(
  tenantId: string,
  projectId: string,
): Promise<{ pages: DocPageMin[] } | null> {
  const url = `${integrationsBase()}/doc/worker/tree`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: config.workerInboundSecret,
      tenant_id: tenantId,
      project_id: projectId,
    }),
  })
  if (!res.ok) return null
  return res.json() as Promise<{ pages: DocPageMin[] }>
}

/**
 * Fetch the project doc tree + per-page headings and format it as a compact
 * plain-text "doc map" injected into agent prompts so they always know
 * what pages exist and where to write or read.
 */
export async function fetchDocMap(tenantId: string, projectId: string): Promise<string> {
  const tree = await fetchDocTree(tenantId, projectId)
  if (!tree || !tree.pages.length) return ''

  const blocksByPage = new Map<string, DocBlock[]>()
  for (const page of tree.pages) {
    const payload = await fetchPageForReindex(tenantId, projectId, page.id)
    if (payload) {
      blocksByPage.set(page.slug, payload.blocks)
    }
  }
  return formatDocMap(tree.pages, blocksByPage)
}
