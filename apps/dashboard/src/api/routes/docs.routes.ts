/**
 * Public Bokito product-help (`/api/docs/*`): unauthenticated how-to articles,
 * keyword search, raw markdown and the curated public OpenAPI schema.
 */
export const docsRoutes = {
  index: '/',
  search: '/search',
  article: (slug: string) => `/${encodeURIComponent(slug)}`,
  articleMarkdown: (slug: string) => `/${encodeURIComponent(slug)}.md`,
  asset: (rel: string) => `/assets/${rel.replace(/^\/+/, '')}`,
  openapi: '/openapi.json',
  sitemap: '/sitemap.xml',
} as const
