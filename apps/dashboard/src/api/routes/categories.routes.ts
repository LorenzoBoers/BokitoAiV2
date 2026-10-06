/** Categories, tickets and project boards on the app group base (`APP_API_BASE`). */
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
  /** Stacked playbook boards for a project. */
  projectBoard: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/board`,
} as const
