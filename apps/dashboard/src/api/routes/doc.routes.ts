import { withQuery } from '../url'

/**
 * Relative paths on the workforce API group base for the project doc system
 * (block-based documentation, replaces pkb_sections).
 */
export const docRoutes = {
  tree: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/doc`,
  pages: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/doc/pages`,
  page: (projectId: string, pageId: string) =>
    `/projects/${encodeURIComponent(projectId)}/doc/pages/${encodeURIComponent(pageId)}`,
  blocks: (projectId: string, pageId: string) =>
    `/projects/${encodeURIComponent(projectId)}/doc/pages/${encodeURIComponent(pageId)}/blocks`,
  revisions: (projectId: string, pageId: string, blockId?: string) => {
    const search = new URLSearchParams()
    if (blockId) search.set('block_id', blockId)
    return withQuery(
      `/projects/${encodeURIComponent(projectId)}/doc/pages/${encodeURIComponent(pageId)}/revisions`,
      search,
    )
  },
  changeRequests: (projectId: string, status?: string) => {
    const search = new URLSearchParams()
    if (status) search.set('status', status)
    return withQuery(
      `/projects/${encodeURIComponent(projectId)}/doc/change-requests`,
      search,
    )
  },
} as const
