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
    forceWake: '/workforce/force-wake',
    forceRescan: '/workforce/force-rescan',
    triggerAgent: '/workforce/trigger-agent',
    completeActivity: '/workforce/complete-activity',
    maintenanceRun: '/workforce/maintenance-run',
  },
  agents: {
    list: '/agents',
    detail: (agentId: string) => `/agents/${encodeURIComponent(agentId)}`,
    status: (agentId: string) => `/agents/${encodeURIComponent(agentId)}/status`,
    lead: (agentId: string) => `/agents/${encodeURIComponent(agentId)}/lead`,
    restore: (agentId: string) => `/agents/${encodeURIComponent(agentId)}/restore`,
    chatAccess: (agentId: string) => `/agents/${encodeURIComponent(agentId)}/chat-access`,
    scopes: (agentId: string) => `/agents/${encodeURIComponent(agentId)}/scopes`,
    scopeKind: (agentId: string, kind: string) =>
      `/agents/${encodeURIComponent(agentId)}/scopes/${encodeURIComponent(kind)}`,
    rules: (agentId: string) => `/agents/${encodeURIComponent(agentId)}/rules`,
    rulesTest: (agentId: string) => `/agents/${encodeURIComponent(agentId)}/rules/test`,
  },
} as const
