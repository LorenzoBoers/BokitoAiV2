import { withQuery } from '../url'

export const githubRoutes = {
  oauth: {
    start: (returnUrl: string, projectId?: string) => {
      const params = new URLSearchParams({ return_url: returnUrl })
      if (projectId) params.set('project_id', projectId)
      return withQuery('/github/oauth/start', params)
    },
  },
  connection: '/github/connection',
  connections: '/github/connections',
  repos: (connectionId?: string) => {
    const params = new URLSearchParams()
    if (connectionId) params.set('connection_id', connectionId)
    const q = params.toString()
    return q ? `/github/repos?${q}` : '/github/repos'
  },
  branches: (owner: string, repo: string, connectionId?: string) => {
    const params = new URLSearchParams()
    if (connectionId) params.set('connection_id', connectionId)
    const q = params.toString()
    const base = `/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`
    return q ? `${base}?${q}` : base
  },
} as const
