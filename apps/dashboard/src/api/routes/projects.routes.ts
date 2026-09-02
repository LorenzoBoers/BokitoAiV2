export const projectsRoutes = {
  list: '/projects',
  byId: (projectId: string) => `/projects/${encodeURIComponent(projectId)}`,
  usageBudget: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/usage/budget`,
  usageSummary: (projectId: string, period?: string) => {
    const search = new URLSearchParams()
    if (period) search.set('period', period)
    const qs = search.toString()
    const base = `/projects/${encodeURIComponent(projectId)}/usage/summary`
    return qs ? `${base}?${qs}` : base
  },
  repo: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/repo`,
  repoReindex: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/repo/reindex`,
  repoStatus: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/repo/status`,
  workstreams: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/workstreams`,
  workstreamById: (projectId: string, workstreamId: string) =>
    `/projects/${encodeURIComponent(projectId)}/workstreams/${encodeURIComponent(workstreamId)}`,
  poAgent: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/po-agent`,
  agents: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/agents`,
  agentById: (projectId: string, agentId: string) =>
    `/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}`,
  queue: (projectId: string, params?: { status?: string; kind?: string }) => {
    const search = new URLSearchParams()
    if (params?.status) search.set('status', params.status)
    if (params?.kind) search.set('kind', params.kind)
    const qs = search.toString()
    const base = `/projects/${encodeURIComponent(projectId)}/queue`
    return qs ? `${base}?${qs}` : base
  },
  queueItem: (projectId: string, itemId: string) =>
    `/projects/${encodeURIComponent(projectId)}/queue/${encodeURIComponent(itemId)}`,
  queueItemAnalyze: (projectId: string, itemId: string) =>
    `/projects/${encodeURIComponent(projectId)}/queue/${encodeURIComponent(itemId)}/analyze`,
  queueItemVerify: (projectId: string, itemId: string) =>
    `/projects/${encodeURIComponent(projectId)}/queue/${encodeURIComponent(itemId)}/verify`,
  docs: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/docs`,
  docLinks: (projectId: string, docId: string) =>
    `/projects/${encodeURIComponent(projectId)}/docs/${encodeURIComponent(docId)}/links`,
  docSection: (projectId: string, docId: string, sectionId: string) =>
    `/projects/${encodeURIComponent(projectId)}/docs/${encodeURIComponent(docId)}/sections/${encodeURIComponent(sectionId)}`,
  docSectionLinks: (projectId: string, docId: string, sectionId: string) =>
    `/projects/${encodeURIComponent(projectId)}/docs/${encodeURIComponent(docId)}/sections/${encodeURIComponent(sectionId)}/links`,
  resources: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/resources`,
  resourceById: (projectId: string, resourceId: string) =>
    `/projects/${encodeURIComponent(projectId)}/resources/${encodeURIComponent(resourceId)}`,
} as const
