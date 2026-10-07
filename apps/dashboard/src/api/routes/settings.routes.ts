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
    /** Live vs mock LLM flag for workspace banners (any member). */
    runtime: '/models/runtime',
    /** Tenant opt-in for custom (BYOK) models. */
    custom: '/models/custom',
    /** Workspace Bokito AI default: automatic | managed tier slug. */
    workspaceChatMode: '/models/workspace-chat-mode',
    /** Workspace data-region policy: allow or block US-hosted platform models. */
    dataRegion: '/models/data-region',
  },
  webhooks: {
    list: '/webhooks',
    byId: (id: string) => `/webhooks/${encodeURIComponent(id)}`,
    test: (id: string) => `/webhooks/${encodeURIComponent(id)}/test`,
    deliveries: (id: string) => `/webhooks/${encodeURIComponent(id)}/deliveries`,
  },
} as const
