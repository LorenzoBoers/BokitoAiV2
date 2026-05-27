import { withQuery } from '../url'

/**
 * Workspace-scoped documentation (central project hub docs).
 */
export const workspaceDocRoutes = {
  tree: () => '/workspace/doc',
  pages: () => '/workspace/doc/pages',
  page: (pageId: string) => `/workspace/doc/pages/${encodeURIComponent(pageId)}`,
  blocks: (pageId: string) => `/workspace/doc/pages/${encodeURIComponent(pageId)}/blocks`,
  revisions: (pageId: string, blockId?: string) => {
    const search = new URLSearchParams()
    if (blockId) search.set('block_id', blockId)
    return withQuery(`/workspace/doc/pages/${encodeURIComponent(pageId)}/revisions`, search)
  },
  changeRequests: (status?: string) => {
    const search = new URLSearchParams()
    if (status) search.set('status', status)
    return withQuery('/workspace/doc/change-requests', search)
  },
  migrateFromProject: () => '/workspace/doc/migrate-from-project',
} as const
