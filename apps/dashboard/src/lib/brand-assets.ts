/**
 * Static fallbacks for integration_hosts when hosted image fields are empty.
 * Official third-party marks: see public/brands/README.md (Simple Icons MIT where noted).
 */

export const BRAND_ASSET_PATHS: Record<string, { logoUrl: string; logoDarkUrl?: string }> = {
  bokito: { logoUrl: '/bokito-logo.svg' },
  github: { logoUrl: '/brands/logo-github.svg' },
  microsoft: { logoUrl: '/brands/logo-microsoft.svg' },
  google: { logoUrl: '/brands/logo-gmail.svg' },
  smtp: { logoUrl: '/brands/logo-smtp-imap.svg' },
  bjorn_lunden: { logoUrl: '/brands/logo-bjorn-lunden.svg' },
  king: { logoUrl: '/brands/logo-bjorn-lunden.svg' },
  custom: { logoUrl: '/brands/logo-custom.svg' },
  notion: { logoUrl: '/brands/logo-notion.svg' },
  linear: { logoUrl: '/brands/logo-linear.svg' },
  atlassian: { logoUrl: '/brands/logo-atlassian.svg' },
  slack: { logoUrl: '/brands/logo-slack.svg' },
  whatsapp: { logoUrl: '/brands/logo-whatsapp.svg' },
  asana: { logoUrl: '/brands/logo-asana.svg' },
  clickup: { logoUrl: '/brands/logo-clickup.svg' },
  sentry: { logoUrl: '/brands/logo-sentry.svg' },
  stripe: { logoUrl: '/brands/logo-stripe.svg' },
  shopify: { logoUrl: '/brands/logo-shopify.svg' },
  higgsfield: { logoUrl: '/brands/logo-higgsfield.svg' },
  moneybird: { logoUrl: '/brands/logo-moneybird.png' },
  exact: { logoUrl: '/brands/logo-exact.png' },
  snelstart: { logoUrl: '/brands/logo-snelstart.png' },
}

export function brandAssetUrl(relativePath: string): string {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/')
  const path = relativePath.replace(/^\//, '')
  return `${base}${path}`
}

export function resolveBrandAssetUrls(
  paths: Record<string, { logoUrl: string; logoDarkUrl?: string }>,
): Record<string, { logoUrl: string; logoDarkUrl?: string }> {
  const out: Record<string, { logoUrl: string; logoDarkUrl?: string }> = {}
  for (const [slug, entry] of Object.entries(paths)) {
    out[slug] = {
      logoUrl: brandAssetUrl(entry.logoUrl),
      ...(entry.logoDarkUrl ? { logoDarkUrl: brandAssetUrl(entry.logoDarkUrl) } : {}),
    }
  }
  return out
}

export const BRAND_ASSETS = resolveBrandAssetUrls(BRAND_ASSET_PATHS)
