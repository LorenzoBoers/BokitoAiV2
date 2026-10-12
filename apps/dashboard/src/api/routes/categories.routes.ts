/** Categories and tickets on the app group base (`APP_API_BASE`). Folder boards live in `foldersRoutes.board`. */
export const categoriesRoutes = {
  list: '/categories',
  byId: (tagId: string) => `/categories/${encodeURIComponent(tagId)}`,
  /** Workspace policy: who may accept proposed tickets, backlog threshold. */
  policy: '/categories/policy',
  /** Recurring patterns no hashtag covers yet. */
  backlog: '/categories/backlog',
  backlogEntry: (key: string) => `/categories/backlog/${encodeURIComponent(key)}`,
  backlogPromote: (key: string) => `/categories/backlog/${encodeURIComponent(key)}/promote`,
  /** The conversation's ticket: GET, PUT (file), PATCH (move, accept), DELETE. */
  ticket: (signalId: string) => `/signals/${encodeURIComponent(signalId)}/ticket`,
} as const
