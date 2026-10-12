/**
 * Folders router (`/api/folders/*`). Operators know a folder as Folder / Map;
 * the id in these paths is still the internal project id.
 */
const base = (folderId: string) => `/${encodeURIComponent(folderId)}`

export const foldersRoutes = {
  list: '',
  byId: (folderId: string) => base(folderId),
  children: (folderId: string) => `${base(folderId)}/children`,
  files: (folderId: string) => `${base(folderId)}/files`,
  board: (folderId: string) => `${base(folderId)}/board`,
  usageBudget: (folderId: string) => `${base(folderId)}/usage/budget`,
  usageSummary: (folderId: string, period?: string) => {
    const search = new URLSearchParams()
    if (period) search.set('period', period)
    const qs = search.toString()
    const path = `${base(folderId)}/usage/summary`
    return qs ? `${path}?${qs}` : path
  },
  repo: (folderId: string) => `${base(folderId)}/repo`,
  repoReindex: (folderId: string) => `${base(folderId)}/repo/reindex`,
  repoStatus: (folderId: string) => `${base(folderId)}/repo/status`,
  poAgent: (folderId: string) => `${base(folderId)}/po-agent`,
  agents: (folderId: string) => `${base(folderId)}/agents`,
  agentById: (folderId: string, agentId: string) =>
    `${base(folderId)}/agents/${encodeURIComponent(agentId)}`,
  queue: (folderId: string, params?: { status?: string; kind?: string }) => {
    const search = new URLSearchParams()
    if (params?.status) search.set('status', params.status)
    if (params?.kind) search.set('kind', params.kind)
    const qs = search.toString()
    const path = `${base(folderId)}/queue`
    return qs ? `${path}?${qs}` : path
  },
  queueItem: (folderId: string, itemId: string) =>
    `${base(folderId)}/queue/${encodeURIComponent(itemId)}`,
  queueItemAnalyze: (folderId: string, itemId: string) =>
    `${base(folderId)}/queue/${encodeURIComponent(itemId)}/analyze`,
  queueItemVerify: (folderId: string, itemId: string) =>
    `${base(folderId)}/queue/${encodeURIComponent(itemId)}/verify`,
  docs: (folderId: string) => `${base(folderId)}/docs`,
  docLinks: (folderId: string, docId: string) =>
    `${base(folderId)}/docs/${encodeURIComponent(docId)}/links`,
  docSection: (folderId: string, docId: string, sectionId: string) =>
    `${base(folderId)}/docs/${encodeURIComponent(docId)}/sections/${encodeURIComponent(sectionId)}`,
  docSectionLinks: (folderId: string, docId: string, sectionId: string) =>
    `${base(folderId)}/docs/${encodeURIComponent(docId)}/sections/${encodeURIComponent(sectionId)}/links`,
  resources: (folderId: string) => `${base(folderId)}/resources`,
  resourceById: (folderId: string, resourceId: string) =>
    `${base(folderId)}/resources/${encodeURIComponent(resourceId)}`,
  canvases: (folderId: string) => `${base(folderId)}/canvases`,
  canvas: (folderId: string, slug: string) =>
    `${base(folderId)}/canvases/${encodeURIComponent(slug)}`,
} as const

export const canvasesRoutes = {
  list: (ownerKind: string, ownerId: string) =>
    `/canvases?owner_kind=${encodeURIComponent(ownerKind)}&owner_id=${encodeURIComponent(ownerId)}`,
  create: '/canvases',
  byId: (canvasId: string) => `/canvases/${encodeURIComponent(canvasId)}`,
} as const
