import { withQuery } from '../url'

/**
 * Relative paths on the app API group base (`APP_API_BASE`).
 * Reconstructed from `origin/master` string literals in workspace, backlog, custom-db, and projects.
 */
export const appRoutes = {
  docs: {
    list: '/docs',
  },
  backlog: {
    items: '/backlog/items',
    item: (id: number) => `/backlog/items/${id}`,
    itemComments: (id: number) => `/backlog/items/${id}/comments`,
    triage: (id: number) => `/backlog/triage/${id}`,
    roadmapReorder: '/backlog/roadmap/reorder',
    config: '/backlog/config',
  },
  workspaces: {
    list: '/workspaces',
    byId: (id: number | string) => `/workspaces/${id}`,
    members: (id: number | string) => `/workspaces/${id}/members`,
    invites: (id: number | string) => `/workspaces/${id}/invites`,
  },
  workspaceInvites: {
    create: '/workspace-invites',
  },
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
    thread: (threadId: string) => `/signals/${threadId}`,
    threadDelete: (threadId: string) => `/signals/${threadId}`,
    threadMarkRead: (threadId: string) => `/signals/${threadId}/mark-read`,
    threadMarkUnread: (threadId: string) => `/signals/${threadId}/mark-unread`,
    threadPin: (threadId: string) => `/signals/${threadId}/pin`,
    threadReply: (threadId: string) => `/signals/${threadId}/reply`,
    threadNotes: (threadId: string) => `/signals/${threadId}/notes`,
    messageResolve: (threadId: string, messageId: string) =>
      `/signals/${threadId}/messages/${messageId}/resolve`,
    pins: '/signals/pins',
    members: '/signals/members',
    syncStatus: '/signals/sync-status',
  },
  orchestration: {
    runtimeProfiles: '/orchestration/runtime-profiles',
    tasks: '/orchestration/tasks',
    task: (id: string) => `/orchestration/tasks/${id}`,
    taskCancel: (id: string) => `/orchestration/tasks/${id}/cancel`,
    taskResume: (id: string) => `/orchestration/tasks/${id}/resume`,
    taskArtifacts: (id: string) => `/orchestration/tasks/${id}/artifacts`,
    workstreamRun: (id: string) => `/orchestration/workstreams/${id}/run`,
    workstreamSteps: (id: string) => `/orchestration/workstreams/${id}/steps`,
    runEvents: (runId: string) => `/orchestration/runs/${runId}/events`,
  },
  triggers: {
    list: '/triggers',
    byId: (id: string) => `/triggers/${id}`,
    run: (id: string) => `/triggers/${id}/run`,
  },
  channelBindings: {
    list: '/channels/bindings',
    byId: (id: string) => `/channels/bindings/${id}`,
  },
  channelAccounts: {
    list: '/channels/accounts',
  },
  contacts: {
    listQuery: (params: URLSearchParams) => withQuery('/channels/contacts', params),
    byId: (id: string) => `/channels/contacts/${id}`,
    threads: (id: string) => `/channels/contacts/${id}/threads`,
  },
  agenda: {
    occurrencesQuery: (params: URLSearchParams) => withQuery('/agenda', params),
  },
} as const
