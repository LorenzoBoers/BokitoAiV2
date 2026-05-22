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
} as const
