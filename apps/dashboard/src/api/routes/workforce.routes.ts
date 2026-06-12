import { withQuery } from '../url'

/**
 * Relative paths on the workforce API group base (`WORKFORCE_API_BASE`).
 */
export const workforceRoutes = {
  workLogs: {
    list: (params?: {
      project_id?: string
      agent_id?: string
      status?: string
      limit?: number
    }) => {
      const search = new URLSearchParams()
      if (params?.project_id) search.set('project_id', params.project_id)
      if (params?.agent_id) search.set('agent_id', params.agent_id)
      if (params?.status) search.set('status', params.status)
      if (params?.limit != null) search.set('limit', String(params.limit))
      return withQuery('/work_logs', search)
    },
    events: (workLogId: string) => `/work_logs/${encodeURIComponent(workLogId)}/events`,
  },
  runs: {
    status: (workLogId: string) => `/runs/${encodeURIComponent(workLogId)}/status`,
    events: (workLogId: string) => `/work_logs/${encodeURIComponent(workLogId)}/events`,
  },
  workforce: {
    config: '/workforce/config',
    statusQuery: (params: URLSearchParams) => withQuery('/workforce/status', params),
    forceWake: '/workforce/force-wake',
    forceRescan: '/workforce/force-rescan',
    pause: '/workforce/pause',
    triggerAgent: '/workforce/trigger-agent',
    completeActivity: '/workforce/complete-activity',
    maintenanceRun: '/workforce/maintenance-run',
  },
  agents: {
    list: '/agents',
    timeline: '/timeline',
    status: (agentId: string) => `/agents/${encodeURIComponent(agentId)}/status`,
    chatAccess: (agentId: string) => `/agents/${encodeURIComponent(agentId)}/chat-access`,
  },
  os: {
    graph: '/os/graph',
    projectGraph: (projectId: string) => `/os/graph/${encodeURIComponent(projectId)}`,
    nodes: '/os/nodes',
    node: (nodeId: string) => `/os/nodes/${encodeURIComponent(nodeId)}`,
    edges: '/os/edges',
    edge: (edgeId: string) => `/os/edges/${encodeURIComponent(edgeId)}`,
  },
} as const
