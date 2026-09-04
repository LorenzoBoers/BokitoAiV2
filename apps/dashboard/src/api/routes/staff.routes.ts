/**
 * Relative paths on the staff API group base (`STAFF_API_BASE`).
 */
export const staffRoutes = {
  ops: '/ops',
  models: {
    list: '/models',
    byId: (id: string) => `/models/${encodeURIComponent(id)}`,
  },
  platformKeys: {
    list: '/platform-keys',
    byProvider: (provider: string) => `/platform-keys/${encodeURIComponent(provider)}`,
  },
  markup: '/markup',
} as const
