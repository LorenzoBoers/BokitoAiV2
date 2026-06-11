import { workforceRoutes } from '../api/routes/workforce.routes'
import { listProjects } from './projects-api'
import { listProjectWorkstreams } from './workstreams-api'
import {
  workforceDelete,
  workforceGet,
  workforcePatch,
  workforcePost,
} from './api'

export type OsNodeType = 'orchestrator' | 'workstream' | 'repo' | 'tool'

export type OsEdgeRelation = 'routed_by' | 'uses_repo' | 'uses_tool'

export const OS_ALLOWED_EDGES: Record<OsEdgeRelation, [OsNodeType, OsNodeType]> = {
  routed_by: ['workstream', 'orchestrator'],
  uses_repo: ['workstream', 'repo'],
  uses_tool: ['workstream', 'tool'],
}

export type OsCanvasNode = {
  id: string
  node_type: OsNodeType
  ref_id: string
  x: number
  y: number
  label: string | null
  title: string
  subtitle: string
  status: string
  href: string | null
  project_id?: string | null
}

export type OsCanvasEdge = {
  id: string
  source_node_id: string
  target_node_id: string
  relation: OsEdgeRelation
  source_type?: OsNodeType
  target_type?: OsNodeType
}

export type OsCanvasGraph = {
  nodes: OsCanvasNode[]
  edges: OsCanvasEdge[]
}

function isGraphEndpointUnavailable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /404|not found/i.test(msg)
}

export function resolveEdgeRelation(
  fromType: OsNodeType,
  toType: OsNodeType,
  fromId: string,
  toId: string,
): { relation: OsEdgeRelation; source_node_id: string; target_node_id: string } | null {
  for (const [relation, [srcType, tgtType]] of Object.entries(OS_ALLOWED_EDGES) as [
    OsEdgeRelation,
    [OsNodeType, OsNodeType],
  ][]) {
    if (fromType === srcType && toType === tgtType) {
      return { relation, source_node_id: fromId, target_node_id: toId }
    }
    if (fromType === tgtType && toType === srcType) {
      return { relation, source_node_id: toId, target_node_id: fromId }
    }
  }
  return null
}

export type OsGraphLoadResult = { graph: OsCanvasGraph; degraded: boolean }

const NODE_W = 200
const NODE_H = 88
const COL_GAP = 80
const ROW_GAP = 120

function fallbackId(type: string, refId: string): string {
  return `fallback-${type}-${refId}`
}

/** Read-only client graph when canvas API is unavailable (404). */
async function buildCanvasGraphFallback(): Promise<OsCanvasGraph> {
  const projects = await listProjects()
  const nodes: OsCanvasNode[] = []
  const edges: OsCanvasEdge[] = []

  for (let col = 0; col < projects.length; col++) {
    const project = projects[col]
    const baseX = 80 + col * (NODE_W + COL_GAP * 2)
    const orchY = 180
    const po = project.po_agent
    const orchNodeId = po?.id ? fallbackId('orchestrator', po.id) : null

    if (po?.id && orchNodeId && !nodes.some((n) => n.id === orchNodeId)) {
      nodes.push({
        id: orchNodeId,
        node_type: 'orchestrator',
        ref_id: po.id,
        x: baseX,
        y: orchY,
        label: po.name,
        title: po.name,
        subtitle: po.role ?? 'orchestrator',
        status: po.status ?? 'standby',
        href: `/os/agents/${po.id}`,
      })
    }

    const { items: workstreams } = await listProjectWorkstreams(project.id)
    workstreams.forEach((ws, wi) => {
      const wsNodeId = fallbackId('workstream', ws.id)
      nodes.push({
        id: wsNodeId,
        node_type: 'workstream',
        ref_id: ws.id,
        x: baseX + (wi % 2) * (NODE_W + 20),
        y: orchY + ROW_GAP + Math.floor(wi / 2) * (NODE_H + 24),
        label: ws.name,
        title: ws.name,
        subtitle: ws.slug,
        status: ws.status,
        href: `/project/${project.id}/overview?stream=${encodeURIComponent(ws.slug)}`,
        project_id: project.id,
      })
      if (orchNodeId) {
        edges.push({
          id: fallbackId('edge', `${ws.id}-${po!.id}`),
          source_node_id: wsNodeId,
          target_node_id: orchNodeId,
          relation: 'routed_by',
        })
      }
    })

    if (project.github_repo_full_name || project.repo_binding_id) {
      const repoNodeId = fallbackId('repo', project.id)
      if (!nodes.some((n) => n.id === repoNodeId)) {
        nodes.push({
          id: repoNodeId,
          node_type: 'repo',
          ref_id: project.id,
          x: baseX,
          y: orchY + ROW_GAP * 2,
          label: project.github_repo_full_name ?? project.name,
          title: 'Source',
          subtitle: project.github_repo_full_name ?? '',
          status: project.repo_index_status ?? 'ready',
          href: `/project/${project.id}/settings`,
          project_id: project.id,
        })
      }
      workstreams.forEach((ws) => {
        edges.push({
          id: fallbackId('edge-repo', `${ws.id}-${project.id}`),
          source_node_id: fallbackId('workstream', ws.id),
          target_node_id: repoNodeId,
          relation: 'uses_repo',
        })
      })
    }
  }

  return { nodes, edges }
}

export async function getCanvasGraph(token?: string): Promise<OsGraphLoadResult> {
  try {
    const raw = await workforceGet<OsCanvasGraph>(workforceRoutes.os.graph, token)
    return {
      graph: {
        nodes: raw.nodes ?? [],
        edges: raw.edges ?? [],
      },
      degraded: false,
    }
  } catch (err) {
    if (!isGraphEndpointUnavailable(err)) throw err
    try {
      const graph = await buildCanvasGraphFallback()
      return { graph, degraded: true }
    } catch {
      return { graph: { nodes: [], edges: [] }, degraded: true }
    }
  }
}

export async function createCanvasNode(
  body: {
    node_type: OsNodeType
    ref_id: string
    x?: number
    y?: number
    label?: string
  },
  token?: string,
): Promise<OsCanvasNode> {
  return workforcePost<OsCanvasNode>(workforceRoutes.os.nodes, body, token)
}

export async function patchCanvasNode(
  nodeId: string,
  body: { x?: number; y?: number; label?: string },
  token?: string,
): Promise<OsCanvasNode> {
  return workforcePatch<OsCanvasNode>(workforceRoutes.os.node(nodeId), body, token)
}

export async function deleteCanvasNode(nodeId: string, token?: string): Promise<void> {
  await workforceDelete(workforceRoutes.os.node(nodeId), undefined, token)
}

export async function createCanvasEdge(
  body: { source_node_id: string; target_node_id: string; relation: OsEdgeRelation },
  token?: string,
): Promise<OsCanvasEdge> {
  return workforcePost<OsCanvasEdge>(workforceRoutes.os.edges, body, token)
}

export async function deleteCanvasEdge(edgeId: string, token?: string): Promise<void> {
  await workforceDelete(workforceRoutes.os.edge(edgeId), undefined, token)
}

/** @deprecated Use getCanvasGraph */
export async function getWorkspaceGraph(token?: string): Promise<OsGraphLoadResult> {
  return getCanvasGraph(token)
}
