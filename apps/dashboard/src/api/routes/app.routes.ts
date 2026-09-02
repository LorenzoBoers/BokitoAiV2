import { withQuery } from '../url'

/**
 * Relative paths on the app API group base (`APP_API_BASE`).
 * Reconstructed from `origin/master` string literals in workspace, backlog, custom-db, and projects.
 */
export const appRoutes = {
  onboarding: {
    status: '/onboarding',
    demoThread: '/onboarding/demo-thread',
  },
  me: {
    preferences: '/me/preferences',
  },
  workspaces: {
    list: '/workspaces',
    byId: (id: number | string) => `/workspaces/${id}`,
    members: (id: number | string) => `/workspaces/${id}/members`,
    member: (id: number | string, memberId: number | string) =>
      `/workspaces/${id}/members/${memberId}`,
    invites: (id: number | string) => `/workspaces/${id}/invites`,
    invite: (id: number | string, inviteId: string) => `/workspaces/${id}/invites/${inviteId}`,
    inviteResend: (id: number | string, inviteId: string) =>
      `/workspaces/${id}/invites/${inviteId}/resend`,
  },
  workspaceInvites: {
    create: '/workspace-invites',
  },
  mailStatus: '/mail-status',
  customTables: {
    list: '/custom-tables',
    byId: (id: number) => `/custom-tables/${id}`,
    fields: (tableId: number) => `/custom-tables/${tableId}/fields`,
    records: (tableId: number) => `/custom-tables/${tableId}/records`,
    search: (tableId: number) => `/custom-tables/${tableId}/search`,
    views: (tableId: number) => `/custom-tables/${tableId}/views`,
    importCsv: (tableId: number) => `/custom-tables/${tableId}/import/csv`,
    export: (tableId: number) => `/custom-tables/${tableId}/export`,
  },
  customFields: {
    byId: (fieldId: number) => `/custom-fields/${fieldId}`,
  },
  customRecords: {
    byId: (recordId: number) => `/custom-records/${recordId}`,
    softDelete: (recordId: number) => `/custom-records/${recordId}/soft-delete`,
    restore: (recordId: number) => `/custom-records/${recordId}/restore`,
    duplicate: (recordId: number) => `/custom-records/${recordId}/duplicate`,
    bulk: '/custom-records/bulk',
    bulkSoftDelete: '/custom-records/bulk-soft-delete',
    bulkRestore: '/custom-records/bulk-restore',
    activity: (recordId: number) => `/custom-records/${recordId}/activity`,
    comments: (recordId: number) => `/custom-records/${recordId}/comments`,
  },
  customViews: {
    byId: (viewId: number) => `/custom-views/${viewId}`,
  },
  recordComments: {
    byId: (commentId: number) => `/record-comments/${commentId}`,
  },
  standardTables: {
    create: '/standard-tables/create',
    list: '/standard-tables',
  },
  workspaceUsers: {
    list: '/workspace-users',
  },
  signals: {
    threadsQuery: (params: URLSearchParams) => withQuery('/signals', params),
    // Assistant conversation facade (chat with company agents).
    chatTargets: '/signals/chat/targets',
    conversations: '/signals/conversations',
    conversationsQuery: (params: URLSearchParams) => withQuery('/signals/conversations', params),
    conversation: (conversationId: string) =>
      `/signals/conversations/${encodeURIComponent(conversationId)}`,
    conversationMessages: (conversationId: string) =>
      `/signals/conversations/${encodeURIComponent(conversationId)}/messages`,
    conversationStream: (conversationId: string) =>
      `/signals/conversations/${encodeURIComponent(conversationId)}/stream`,
    thread: (threadId: string) => `/signals/${threadId}`,
    threadDelete: (threadId: string) => `/signals/${threadId}`,
    threadMarkRead: (threadId: string) => `/signals/${threadId}/mark-read`,
    threadMarkUnread: (threadId: string) => `/signals/${threadId}/mark-unread`,
    threadPin: (threadId: string) => `/signals/${threadId}/pin`,
    threadReply: (threadId: string) => `/signals/${threadId}/reply`,
    messageCancel: (messageId: string) => `/signals/messages/${messageId}/cancel`,
    threadDraft: (threadId: string) => `/signals/${threadId}/draft`,
    threadNotes: (threadId: string) => `/signals/${threadId}/notes`,
    threadTakeover: (threadId: string) => `/signals/${threadId}/takeover`,
    threadRelease: (threadId: string) => `/signals/${threadId}/release`,
    threadInvokeAgent: (threadId: string) => `/signals/${threadId}/invoke-agent`,
    threadAgentCandidates: (threadId: string) => `/signals/${threadId}/agent-candidates`,
    threadSessions: (threadId: string) => `/signals/${threadId}/sessions`,
    threadSession: (threadId: string, sessionId: string) =>
      `/signals/${threadId}/sessions/${sessionId}`,
    threadSessionClose: (threadId: string, sessionId: string) =>
      `/signals/${threadId}/sessions/${sessionId}/close`,
    messageResolve: (threadId: string, messageId: string) =>
      `/signals/${threadId}/messages/${messageId}/resolve`,
    pins: '/signals/pins',
    members: '/signals/members',
    tags: '/signals/tags',
    tag: (tag: string) => `/signals/tags/${encodeURIComponent(tag)}`,
    badgeCounts: '/signals/badge-counts',
    dismissNoReplySuggestions: '/signals/dismiss-no-reply-suggestions',
    bulk: '/signals/bulk',
    savedReplies: '/signals/saved-replies',
    savedReply: (replyId: string) => `/signals/saved-replies/${replyId}`,
    rules: '/signals/rules',
    rule: (ruleId: string) => `/signals/rules/${ruleId}`,
    note: (threadId: string, messageId: string) => `/signals/${threadId}/notes/${messageId}`,
    messageFeedback: (messageId: string) => `/messages/${messageId}/feedback`,
  },
  uploads: {
    create: '/uploads',
    file: (tenantId: string, filename: string) => `/uploads/files/${tenantId}/${filename}`,
  },
  learning: {
    feedback: '/learning/feedback',
  },
  inbox: {
    settings: '/inbox/settings',
  },
  orchestration: {
    workstreams: '/orchestration/workstreams',
    tasks: '/orchestration/tasks',
    task: (id: string) => `/orchestration/tasks/${id}`,
    taskCancel: (id: string) => `/orchestration/tasks/${id}/cancel`,
    taskResume: (id: string) => `/orchestration/tasks/${id}/resume`,
    taskArtifacts: (id: string) => `/orchestration/tasks/${id}/artifacts`,
    workstreamRun: (id: string) => `/orchestration/workstreams/${id}/run`,
    workstreamSteps: (id: string) => `/orchestration/workstreams/${id}/steps`,
    workstreamStep: (workstreamId: string, stepId: string) =>
      `/orchestration/workstreams/${workstreamId}/steps/${stepId}`,
    runEvents: (runId: string) => `/orchestration/runs/${runId}/events`,
  },
  triggers: {
    list: '/triggers',
    byId: (id: string) => `/triggers/${id}`,
    run: (id: string) => `/triggers/${id}/run`,
    rotateWebhookSecret: (id: string) => `/triggers/${id}/rotate-webhook-secret`,
    testWebhook: (id: string) => `/triggers/${id}/test-webhook`,
  },
  channelBindings: {
    list: '/channels/bindings',
    byId: (id: string) => `/channels/bindings/${id}`,
  },
  channelAccounts: {
    list: '/channels/accounts',
    byId: (id: string) => `/channels/accounts/${id}`,
    visibility: (id: string) => `/channels/accounts/${id}/visibility`,
    verify: (id: string) => `/channels/accounts/${id}/verify`,
    whatsappSetup: '/channels/whatsapp/setup',
  },
  channels: {
    // Uniform channel rows: state, capabilities, checks.
    list: '/channels',
    byId: (id: string) => `/channels/accounts/${id}`,
    sync: (id: string) => `/channels/accounts/${id}/sync`,
    emailRelays: '/channels/email/relays',
  },
  contacts: {
    list: '/channels/contacts',
    listQuery: (params: URLSearchParams) => withQuery('/channels/contacts', params),
    byId: (id: string) => `/channels/contacts/${id}`,
    threads: (id: string) => `/channels/contacts/${id}/threads`,
  },
  companies: {
    list: '/channels/companies',
    listQuery: (params: URLSearchParams) => withQuery('/channels/companies', params),
    byId: (id: string) => `/channels/companies/${id}`,
    backfill: '/channels/companies/backfill',
  },
  agenda: {
    occurrencesQuery: (params: URLSearchParams) => withQuery('/agenda', params),
  },
  privacy: {
    settings: '/privacy/settings',
    export: '/privacy/export',
    eraseSubject: '/privacy/erase-subject',
  },
  notifications: {
    list: '/notifications',
    markRead: (id: string) => `/notifications/${id}/read`,
    markAllRead: '/notifications/read-all',
  },
  push: {
    subscribe: '/push/subscribe',
    unsubscribe: '/push/unsubscribe',
    vapidPublicKey: '/push/vapid-public-key',
  },
} as const
