/**
 * Relative paths on the staff API group base (`STAFF_API_BASE`).
 */
export const staffRoutes = {
  ops: '/ops',
  opsTenant: (tenantId: string) => `/ops/tenants/${encodeURIComponent(tenantId)}`,
  models: {
    list: '/models',
    byId: (id: string) => `/models/${encodeURIComponent(id)}`,
  },
  platformKeys: {
    list: '/platform-keys',
    byProvider: (provider: string) => `/platform-keys/${encodeURIComponent(provider)}`,
  },
  markup: '/markup',
  integrationCatalog: {
    hosts: '/integrations/catalog/hosts',
    hostBySlug: (slug: string) => `/integrations/catalog/hosts/${encodeURIComponent(slug)}`,
    providers: '/integrations/catalog/providers',
    providerBySlug: (slug: string) =>
      `/integrations/catalog/providers/${encodeURIComponent(slug)}`,
  },
} as const
