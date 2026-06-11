import { withQuery } from '../url'

/**
 * Workspace markdown docs (memory, persona, skills, docs, daily logs).
 */
export const workspaceRoutes = {
  docs: (kind?: string) => {
    const search = new URLSearchParams()
    if (kind) search.set('kind', kind)
    return withQuery('/workspace/docs', search)
  },
  doc: (docId: string) => `/workspace/docs/${encodeURIComponent(docId)}`,
  search: () => '/workspace/search',
} as const
