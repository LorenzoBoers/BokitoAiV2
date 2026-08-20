/**
 * Public help center (`/api/help/*`): unauthenticated, tenant-slug scoped.
 */
export const helpRoutes = {
  center: (tenantSlug: string) => `/${encodeURIComponent(tenantSlug)}`,
  article: (tenantSlug: string, articleSlug: string) =>
    `/${encodeURIComponent(tenantSlug)}/${encodeURIComponent(articleSlug)}`,
} as const
