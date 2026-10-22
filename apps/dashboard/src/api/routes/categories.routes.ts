/** Labels with a flow and tickets on the app group base (`APP_API_BASE`). Folder boards live in `foldersRoutes.board`. */
export const categoriesRoutes = {
  list: '/labels',
  byId: (tagId: string) => `/labels/${encodeURIComponent(tagId)}`,
  /** Workspace policy: who may accept proposed tickets, backlog threshold. */
  policy: '/labels/policy',
  /** Recurring patterns no label covers yet. */
  backlog: '/labels/backlog',
  backlogEntry: (key: string) => `/labels/backlog/${encodeURIComponent(key)}`,
  backlogPromote: (key: string) => `/labels/backlog/${encodeURIComponent(key)}/promote`,
  /** The conversation's ticket: GET, PUT (file), PATCH (move, accept), DELETE. */
  ticket: (signalId: string) => `/signals/${encodeURIComponent(signalId)}/ticket`,
} as const
