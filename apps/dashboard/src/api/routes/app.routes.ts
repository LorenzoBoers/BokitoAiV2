import { withQuery } from '../url'

/**
 * Relative paths on the app API group base (`APP_API_BASE`).
 * Reconstructed from `origin/master` string literals in workspace, backlog, custom-db, and projects.
 */
export const appRoutes = {
  onboarding: {
    status: '/onboarding',
    demoThread: '/onboarding/demo-thread',
    wizard: '/onboarding/wizard',
  },
  me: {
    preferences: '/me/preferences',
    assistantMemory: '/me/assistant-memory',
    assistantMemoryKey: (key: string) => `/me/assistant-memory/${encodeURIComponent(key)}`,
  },
  workspaces: {
    list: '/workspaces',
    byId: (id: number | string) => `/workspaces/${id}`,
    members: (id: number | string) => `/workspaces/${id}/members`,
    member: (id: number | string, memberId: number | string) =>
      `/workspaces/${id}/members/${memberId}`,
    memberReactivate: (id: number | string, memberId: number | string) =>
      `/workspaces/${id}/members/${memberId}/reactivate`,
    invites: (id: number | string) => `/workspaces/${id}/invites`,
    invite: (id: number | string, inviteId: string) => `/workspaces/${id}/invites/${inviteId}`,
    inviteResend: (id: number | string, inviteId: string) =>
      `/workspaces/${id}/invites/${inviteId}/resend`,
  },
  workspaceInvites: {
    create: '/workspace-invites',
  },
  assistant: {
    /** This user's Bokito helper threads across every workspace they belong to. */
    threads: '/assistant/threads',
  },
  mailStatus: '/mail-status',
  // The custom-table builder routes are gone: that router is no longer mounted.
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
    conversationCancel: (conversationId: string) =>
      `/signals/conversations/${encodeURIComponent(conversationId)}/cancel`,
    thread: (threadId: string) => `/signals/${threadId}`,
    threadDelete: (threadId: string) => `/signals/${threadId}`,
    threadMarkRead: (threadId: string) => `/signals/${threadId}/mark-read`,
    threadMarkUnread: (threadId: string) => `/signals/${threadId}/mark-unread`,
    threadPin: (threadId: string) => `/signals/${threadId}/pin`,
    threadSplit: (threadId: string) => `/signals/${threadId}/split`,
    threadReply: (threadId: string) => `/signals/${threadId}/reply`,
    messageCancel: (messageId: string) => `/signals/messages/${messageId}/cancel`,
    threadDraft: (threadId: string) => `/signals/${threadId}/draft`,
    threadHandledExternally: (threadId: string) => `/signals/${threadId}/handled-externally`,
    threadNotes: (threadId: string) => `/signals/${threadId}/notes`,
    threadInvokeAgent: (threadId: string) => `/signals/${threadId}/invoke-agent`,
    threadAgentCandidates: (threadId: string) => `/signals/${threadId}/agent-candidates`,
    threadAssignees: (threadId: string) => `/signals/${threadId}/assignees`,
    threadSessions: (threadId: string) => `/signals/${threadId}/sessions`,
    threadContactLink: (threadId: string) => `/signals/${threadId}/contact-link`,
    threadSession: (threadId: string, sessionId: string) =>
      `/signals/${threadId}/sessions/${sessionId}`,
    threadSessionClose: (threadId: string, sessionId: string) =>
      `/signals/${threadId}/sessions/${sessionId}/close`,
    threadMessage: (threadId: string, messageId: string) =>
      `/signals/${threadId}/messages/${messageId}`,
    messageResolve: (threadId: string, messageId: string) =>
      `/signals/${threadId}/messages/${messageId}/resolve`,
    pins: '/signals/pins',
    members: '/signals/members',
    badgeCounts: '/signals/badge-counts',
    dismissNoReplySuggestions: '/signals/dismiss-no-reply-suggestions',
    bulk: '/signals/bulk',
    savedReplies: '/signals/saved-replies',
    savedReply: (replyId: string) => `/signals/saved-replies/${replyId}`,
    rules: '/signals/rules',
    rule: (ruleId: string) => `/signals/rules/${ruleId}`,
    tags: '/signals/tags',
    tag: (tagId: string) => `/signals/tags/${tagId}`,
    /** Attach a playbook to a free tag: it becomes a category. */
    tagPromote: (tagId: string) => `/signals/tags/${tagId}/promote`,
    /** Communication rail rows: categories, pinned tags, projects. */
    nav: '/signals/nav',
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
  orchestration: {
    runEvents: (runId: string) => `/orchestration/runs/${runId}/events`,
    tasks: '/orchestration/tasks',
    taskById: (taskId: string) => `/orchestration/tasks/${taskId}`,
  },
  triggers: {
    list: '/triggers',
    byId: (id: string) => `/triggers/${id}`,
    run: (id: string) => `/triggers/${id}/run`,
    rotateWebhookSecret: (id: string) => `/triggers/${id}/rotate-webhook-secret`,
    testWebhook: (id: string) => `/triggers/${id}/test-webhook`,
  },
  channelAccounts: {
    list: '/channels/accounts',
    byId: (id: string) => `/channels/accounts/${id}`,
    access: (id: string) => `/channels/accounts/${id}/access`,
    verify: (id: string) => `/channels/accounts/${id}/verify`,
    whatsappSetup: '/channels/whatsapp/setup',
  },
  channels: {
    // Uniform channel rows: state, capabilities, checks.
    list: '/channels',
    /** Single-truth DTO for Setup, Connections, composer banners. */
    status: '/channels/status',
    byId: (id: string) => `/channels/accounts/${id}`,
    sync: (id: string) => `/channels/accounts/${id}/sync`,
    widget: (id: string) => `/channels/accounts/${id}/widget`,
    createWidget: '/channels/widget',
    emailRelays: '/channels/email/relays',
  },
  contacts: {
    list: '/channels/contacts',
    listQuery: (params: URLSearchParams) => withQuery('/channels/contacts', params),
    byId: (id: string) => `/channels/contacts/${id}`,
    threads: (id: string) => `/channels/contacts/${id}/threads`,
    detachIdentity: (id: string, identityId: string) =>
      `/channels/contacts/${id}/identities/${identityId}/detach`,
  },
  companies: {
    list: '/channels/companies',
    listQuery: (params: URLSearchParams) => withQuery('/channels/companies', params),
    byId: (id: string) => `/channels/companies/${id}`,
    backfill: '/channels/companies/backfill',
  },
  teams: {
    list: '/teams',
    overview: '/teams/overview',
    byId: (id: string) => `/teams/${id}`,
    members: (id: string) => `/teams/${id}/members`,
    myAway: '/teams/me/away',
    room: (id: string) => `/teams/${id}/room`,
  },
  agenda: {
    occurrencesQuery: (params: URLSearchParams) => withQuery('/agenda', params),
  },
  privacy: {
    settings: '/privacy/settings',
    export: '/privacy/export',
    eraseSubject: '/privacy/erase-subject',
  },
  trash: {
    list: (params?: URLSearchParams) => withQuery('/trash', params ?? new URLSearchParams()),
    settings: '/trash/settings',
    empty: '/trash/empty',
    restore: (id: string) => `/trash/${encodeURIComponent(id)}/restore`,
    byId: (id: string) => `/trash/${encodeURIComponent(id)}`,
  },
  notifications: {
    list: '/notifications',
    markRead: (id: string) => `/notifications/${id}/read`,
    markAllRead: '/notifications/read-all',
    decisionLearn: (decisionId: string) => `/notifications/decisions/${encodeURIComponent(decisionId)}/learn`,
    decisionGroups: '/notifications/decisions/groups',
    decisionsDismiss: '/notifications/decisions/dismiss',
  },
  push: {
    subscribe: '/push/subscribe',
    unsubscribe: '/push/unsubscribe',
    vapidPublicKey: '/push/vapid-public-key',
  },
  cockpit: {
    summary: '/cockpit/summary',
    activity: (params: URLSearchParams) => withQuery('/cockpit/activity', params),
    usage: (days: number) => withQuery('/cockpit/usage', new URLSearchParams({ days: String(days) })),
    budget: '/cockpit/budget',
  },
} as const
