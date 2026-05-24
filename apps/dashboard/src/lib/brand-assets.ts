/**
 * Optional static fallbacks: official brand SVGs only (see file headers in public/brands/).
 * Hosts without an official asset use initials placeholder until Xano `integration_hosts.logo` is set.
 */

export const BRAND_ASSET_PATHS: Record<string, { logoUrl: string; logoDarkUrl?: string }> = {
  /** Simple Icons / GitHub brand (https://github.com/logos) */
  github: { logoUrl: '/brands/logo-github.svg' },
  /** Microsoft Outlook product icon (Fluent UI asset, pre-existing in repo) */
  microsoft: { logoUrl: '/brands/logo-outlook.svg' },
  /** Google Gmail product logo (multi-color; Google product log set) */
  google: { logoUrl: '/brands/logo-gmail.svg' },
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
