import { withQuery } from '../url'

/**
 * Relative paths on the integrations API group base (`INTEGRATIONS_API_BASE`).
 * Reconstructed from `origin/master` literals in `email-api.ts` and `inbox-api.ts`, plus newer inbox pin routes.
 */
export const integrationsRoutes = {
  email: {
    connections: {
      list: '/email/connections',
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
    messages: {
      listQuery: (params: URLSearchParams) => withQuery('/email/messages', params),
      byId: (messageId: number) => `/email/messages/${messageId}`,
      snooze: (messageId: number) => `/email/messages/${messageId}/snooze`,
      aiSuggest: (messageId: number) => `/email/messages/${messageId}/ai-suggest`,
      aiSummarize: (messageId: number) => `/email/messages/${messageId}/ai-summarize`,
      aiSentiment: (messageId: number) => `/email/messages/${messageId}/ai-sentiment`,
      aiCategorize: (messageId: number) => `/email/messages/${messageId}/ai-categorize`,
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
