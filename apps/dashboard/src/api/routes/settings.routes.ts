/**
 * Relative paths on the settings API group base (`SETTINGS_API_BASE`).
 */
export const settingsRoutes = {
  providers: {
    list: '/providers',
    byId: (id: string) => `/providers/${encodeURIComponent(id)}`,
    test: (id: string) => `/providers/${encodeURIComponent(id)}/test`,
  },
  models: {
    list: '/models',
    byId: (id: string) => `/models/${encodeURIComponent(id)}`,
  },
} as const
