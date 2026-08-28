import { withQuery } from '../url'

/**
 * Relative paths on the integrations API group base (`INTEGRATIONS_API_BASE`).
 * Reconstructed from `origin/master` literals in `email-api.ts` and `inbox-api.ts`, plus newer inbox pin routes.
 */
export const integrationsRoutes = {
  platform: {
    providers: '/integrations/providers',
    moduleBySlug: (slug: string) => `/integrations/modules/${encodeURIComponent(slug)}`,
    accountingCompanies: '/integrations/modules/accounting/companies',
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
  },
  email: {
    connections: {
      // FastAPI serves email channel accounts (numeric id matches the
      // `email_connection_id` filter on /api/signals).
      list: '/email/accounts',
      // Built-in per-tenant Bokito address (lazily created server-side).
      bokitoAddress: '/email/bokito-address',
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
    sync: '/email/sync',
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
      byId: (collectionId: number) => `/kb/collections/${collectionId}`,
      documents: (collectionId: number) => `/kb/collections/${collectionId}/documents`,
    },
    documents: {
      byId: (documentId: number) => `/kb/documents/${documentId}`,
    },
    searchQuery: (params: URLSearchParams) => withQuery('/kb/search', params),
  },
} as const
