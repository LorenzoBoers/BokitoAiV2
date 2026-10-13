/**
 * Folders router (`/api/folders/*`). Operators know a folder as Folder / Map;
 * the id in these paths is still the internal project id.
 */
const base = (folderId: string) => `/${encodeURIComponent(folderId)}`

export const foldersRoutes = {
  list: '',
  byId: (folderId: string) => base(folderId),
  nest: (folderId: string) => `${base(folderId)}/nest`,
  files: (folderId: string) => `${base(folderId)}/files`,
  board: (folderId: string) => `${base(folderId)}/board`,
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
  bySignal: (signalId: string) => `/canvases?signal_id=${encodeURIComponent(signalId)}`,
  create: '/canvases',
  byId: (canvasId: string) => `/canvases/${encodeURIComponent(canvasId)}`,
} as const
