import { withQuery } from '../url'

/**
 * Relative paths on the integrations API group base (`INTEGRATIONS_API_BASE`).
 * Reconstructed from `origin/master` literals in `email-api.ts` and `inbox-api.ts`, plus newer inbox pin routes.
 */
export const integrationsRoutes = {
  platform: {
    providers: '/integrations/providers',
    connections: (provider?: string) => {
      const params = new URLSearchParams()
      if (provider) params.set('provider', provider)
      const q = params.toString()
      return q ? `/integrations/connections?${q}` : '/integrations/connections'
    },
    connectionById: (connectionId: string) => `/integrations/connections/${connectionId}`,
    connectionResources: (connectionId: string) =>
      `/integrations/connections/${connectionId}/resources`,
    oauthStart: (provider: string, returnUrl: string, projectId?: string) => {
      const params = new URLSearchParams({
        provider,
        return_url: returnUrl,
      })
      if (projectId) params.set('project_id', projectId)
      return withQuery('/integrations/oauth/start', params)
    },
    workerCredentials: '/integrations/worker/credentials',
    mcpBindings: '/integrations/mcp/bindings',
    mcpInstall: '/integrations/mcp/install',
    mcpTest: (serverId: string) => `/integrations/mcp/${serverId}/test`,
    mcpOAuthStart: (provider: string, returnUrl: string) => {
      const params = new URLSearchParams({
        provider,
        return_url: returnUrl,
      })
      return withQuery('/integrations/mcp/oauth/start', params)
    },
    workerMcpCredentials: '/integrations/worker/mcp-credentials',
    mcpOAuthRefresh: '/integrations/mcp/oauth/refresh',
  },
  email: {
    connections: {
      // FastAPI serves email channel accounts (numeric id matches the
      // `email_connection_id` filter on /api/signals).
      list: '/email/accounts',
      byId: (connectionId: number) => `/email/connections/${connectionId}`,
      folders: (connectionId: number) => `/email/connections/${connectionId}/folders`,
      mailboxSettings: (connectionId: number) => `/email/connections/${connectionId}/mailbox-settings`,
      signature: (connectionId: number) => `/email/connections/${connectionId}/signature`,
      aiConfig: (connectionId: number) => `/email/connections/${connectionId}/ai-config`,
    },
    oauth: {
      start: (provider: string, encodedReturnUrl: string) =>
        `/email/oauth/start?provider=${provider}&return_url=${encodedReturnUrl}`,
      outlookStart: (encodedReturnUrl: string) => `/email/outlook/oauth/start?return_url=${encodedReturnUrl}`,
      googleStart: (encodedReturnUrl: string) => `/email/google/oauth/start?return_url=${encodedReturnUrl}`,
    },
    send: '/email/send',
    routingRules: {
      withMailbox: (mailboxId: number) => `/email/routing-rules?mailbox_id=${mailboxId}`,
      base: '/email/routing-rules',
      byId: (ruleId: number) => `/email/routing-rules/${ruleId}`,
    },
  },
  kb: {
    collections: {
      list: '/kb/collections',
      create: '/kb/collections',
      documents: (collectionId: number) => `/kb/collections/${collectionId}/documents`,
    },
    documents: {
      byId: (documentId: number) => `/kb/documents/${documentId}`,
    },
    searchQuery: (params: URLSearchParams) => withQuery('/kb/search', params),
  },
  inbox: {
    threadsQuery: (params: URLSearchParams) => withQuery('/inbox/threads', params),
    thread: (threadId: number) => `/inbox/threads/${threadId}`,
    threadDelete: (threadId: number) => `/inbox/threads/${threadId}`,
    threadMarkRead: (threadId: number) => `/inbox/threads/${threadId}/mark-read`,
    threadMarkUnread: (threadId: number) => `/inbox/threads/${threadId}/mark-unread`,
    threadPin: (threadId: number) => `/inbox/threads/${threadId}/pin`,
    threadReply: (threadId: number) => `/inbox/threads/${threadId}/reply`,
    threadNotes: (threadId: number) => `/inbox/threads/${threadId}/notes`,
    pins: '/inbox/pins',
    members: '/inbox/members',
    syncStatus: '/inbox/sync-status',
  },
} as const
