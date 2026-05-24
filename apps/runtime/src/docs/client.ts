import { config } from '../config.js'

const integrationsBase = () => {
  const base = config.xanoBaseUrl
  if (!base) return ''
  return `${base}/api:integrations`
}

export interface DocBlock {
  id: string
  page_id: string
  parent_block_id: string | null
  type: string
  text: Array<{ text?: string }> | null
  props: Record<string, unknown> | null
  position: number
}

export interface DocPage {
  id: string
  title: string
  slug: string
  kind: string
  is_locked?: boolean
}

export interface ReindexPagePayload {
  page: DocPage
  blocks: DocBlock[]
}

export type AgentBlockOp =
  | {
      op: 'create'
      id?: string
      parent_block_id?: string | null
      type: string
      text?: Array<{ text?: string }>
      props?: Record<string, unknown>
      position?: number
    }
  | {
      op: 'update'
      id: string
      type?: string
      text?: Array<{ text?: string }>
      props?: Record<string, unknown>
    }
  | {
      op: 'move'
      id: string
      parent_block_id?: string | null
      position: number
    }
  | { op: 'delete'; id: string }

/**
 * Fetch a page's blocks for embedding via the worker reindex-page endpoint.
 */
export async function fetchPageForReindex(
  tenantId: string,
  projectId: string,
  pageId: string,
): Promise<ReindexPagePayload | null> {
  const url = `${integrationsBase()}/doc/worker/reindex-page`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: config.workerInboundSecret,
      tenant_id: tenantId,
      project_id: projectId,
      page_id: pageId,
    }),
  })
  if (!res.ok) {
    console.warn('[doc-worker] reindex-page fetch failed', res.status)
    return null
  }
  return res.json() as Promise<ReindexPagePayload>
}

/**
 * Apply a batch of agent block ops via the worker batch endpoint. Every
 * resulting revision is recorded with actor_type=agent and the supplied
 * change_note (required by the endpoint).
 */
export async function applyAgentBlockOps(input: {
  tenantId: string
  projectId: string
  pageId: string
  agentId: string
  actorLabel: string
  changeNote: string
  ops: AgentBlockOp[]
}): Promise<{ applied: DocBlock[]; page_id: string }> {
  const url = `${integrationsBase()}/doc/worker/blocks`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: config.workerInboundSecret,
      tenant_id: input.tenantId,
      project_id: input.projectId,
      page_id: input.pageId,
      agent_id: input.agentId,
      actor_label: input.actorLabel,
      change_note: input.changeNote,
      ops: input.ops,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`agent doc batch failed: ${res.status} ${body.slice(0, 200)}`)
  }
  return res.json() as Promise<{ applied: DocBlock[]; page_id: string }>
}
