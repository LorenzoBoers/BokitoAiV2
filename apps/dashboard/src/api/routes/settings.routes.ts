import { withQuery } from '../url'

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
    imageModel: '/models/image-model',
    /** Workspace data-region policy: allow or block US-hosted platform models. */
    dataRegion: '/models/data-region',
  },
  webhooks: {
    list: '/webhooks',
    listQuery: (params: URLSearchParams) => withQuery('/webhooks', params),
    byId: (id: string) => `/webhooks/${encodeURIComponent(id)}`,
    test: (id: string) => `/webhooks/${encodeURIComponent(id)}/test`,
    deliveries: (id: string, params?: URLSearchParams) =>
      params
        ? withQuery(`/webhooks/${encodeURIComponent(id)}/deliveries`, params)
        : `/webhooks/${encodeURIComponent(id)}/deliveries`,
  },
} as const
