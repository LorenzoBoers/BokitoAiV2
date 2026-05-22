import { withQuery } from '../url'

/**
 * Relative paths on the workforce API group base (`WORKFORCE_API_BASE`).
 */
export const workforceRoutes = {
  runs: {
    status: (workLogId: string) => `/runs/${encodeURIComponent(workLogId)}/status`,
    events: (workLogId: string) => `/work_logs/${encodeURIComponent(workLogId)}/events`,
  },
  index: {
    search: '/index/search',
    chunks: '/index/chunks',
  },
  pkb: {
    patch: (sectionId: string) => `/pkb/${encodeURIComponent(sectionId)}`,
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
  },
} as const
