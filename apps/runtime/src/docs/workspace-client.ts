import { config } from '../config.js'
import type { DocBlock, DocPage, ReindexPagePayload } from './client.js'

const integrationsBase = () => {
  const base = config.xanoBaseUrl
  if (!base) return ''
  return `${base}/api:integrations`
}

const workforceBase = () => {
  const base = config.xanoBaseUrl
  if (!base) return ''
  return `${base}/api:workforce`
}

export interface WorkspaceDocPage extends DocPage {
  workspace_doc_id?: string
  content_hash?: string | null
  rendered_plaintext?: string | null
  rendered_markdown?: string | null
  content_version?: number
}

export interface WorkspaceReindexPagePayload extends ReindexPagePayload {
  page: WorkspaceDocPage
}

export type WorkspaceAgentBlockOp =
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

export async function fetchWorkspacePageForReindex(
  tenantId: string,
  workspaceDocId: string,
  pageId: string,
): Promise<WorkspaceReindexPagePayload | null> {
  const url = `${integrationsBase()}/workspace/doc/worker/reindex-page`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: config.workerInboundSecret,
      tenant_id: tenantId,
      workspace_doc_id: workspaceDocId,
      page_id: pageId,
    }),
  })
  if (!res.ok) {
    console.warn('[workspace-doc-worker] reindex-page fetch failed', res.status)
    return null
  }
  return res.json() as Promise<WorkspaceReindexPagePayload>
}

export async function fetchWorkspaceDocTree(
  tenantId: string,
  workspaceDocId: string,
): Promise<{ pages: Array<{ id: string; title: string; slug: string; kind: string }> } | null> {
  const url = `${integrationsBase()}/workspace/doc/worker/tree`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: config.workerInboundSecret,
      tenant_id: tenantId,
      workspace_doc_id: workspaceDocId,
    }),
  })
  if (!res.ok) return null
  const data = (await res.json()) as { pages?: Array<{ id: string; title: string; slug: string; kind: string }> }
  return { pages: data.pages ?? [] }
}

export async function patchWorkspacePageProjections(input: {
  tenantId: string
  pageId: string
  renderedMarkdown: string
  renderedPlaintext: string
  contentHash: string
}): Promise<void> {
  const url = `${workforceBase()}/workspace/doc/worker/pages/${encodeURIComponent(input.pageId)}/projections`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      worker_api_key: config.xanoWorkerApiKey,
      tenant_id: input.tenantId,
      page_id: input.pageId,
      rendered_markdown: input.renderedMarkdown,
      rendered_plaintext: input.renderedPlaintext,
      content_hash: input.contentHash,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.warn('[workspace-doc-worker] projections patch failed', res.status, body.slice(0, 200))
  }
}

export async function applyWorkspaceAgentBlockOps(input: {
  tenantId: string
  workspaceDocId: string
  pageId: string
  agentId: string
  actorLabel: string
  changeNote: string
  idempotencyKey?: string
  ops: WorkspaceAgentBlockOp[]
}): Promise<{ applied: DocBlock[]; page_id: string; content_version?: number }> {
  const url = `${integrationsBase()}/workspace/doc/worker/blocks`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: config.workerInboundSecret,
      tenant_id: input.tenantId,
      workspace_doc_id: input.workspaceDocId,
      page_id: input.pageId,
      agent_id: input.agentId,
      actor_label: input.actorLabel,
      change_note: input.changeNote,
      idempotency_key: input.idempotencyKey,
      ops: input.ops,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`workspace agent doc batch failed: ${res.status} ${body.slice(0, 200)}`)
  }
  return res.json() as Promise<{ applied: DocBlock[]; page_id: string; content_version?: number }>
}
