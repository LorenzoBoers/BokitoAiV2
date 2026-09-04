import { withQuery } from '../url'

/**
 * Workspace markdown docs (memory, persona, skills, docs, daily logs).
 */
export type WorkspaceDocsQuery = {
  kind?: string
  project_id?: string
  agent_id?: string
  scope?: 'all'
  limit?: number
}

export const workspaceRoutes = {
  docs: (params?: WorkspaceDocsQuery | string) => {
    const search = new URLSearchParams()
    if (typeof params === 'string') {
      if (params) search.set('kind', params)
    } else if (params) {
      if (params.kind) search.set('kind', params.kind)
      if (params.project_id) search.set('project_id', params.project_id)
      if (params.agent_id) search.set('agent_id', params.agent_id)
      if (params.scope) search.set('scope', params.scope)
      if (params.limit != null) search.set('limit', String(params.limit))
    }
    return withQuery('/workspace/docs', search)
  },
  doc: (docId: string) => `/workspace/docs/${encodeURIComponent(docId)}`,
  docPublish: (docId: string) => `/workspace/docs/${encodeURIComponent(docId)}/publish`,
  docsUpload: () => '/workspace/docs/upload',
  docSections: (docId: string) => `/workspace/docs/${encodeURIComponent(docId)}/sections`,
  docSection: (docId: string, sectionId: string) =>
    `/workspace/docs/${encodeURIComponent(docId)}/sections/${encodeURIComponent(sectionId)}`,
  search: () => '/workspace/search',
} as const
