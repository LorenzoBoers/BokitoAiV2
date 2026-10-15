import type {
  ApplicationOfferRow,
  IntegrationApplication,
  IntegrationOffer,
} from './integration-applications'
import { flattenApplicationOffers, localizeApplication, localizeOfferCopy } from './integration-applications'
import type { IntegrationModuleRow } from './integrations-api'
import { STATIC_ID_TO_SLUG } from './integrations/registry'
import { REMOTE_MCP_PROVIDERS } from './mcp-remote-providers'
import { moduleHomePath } from './integration-modules'

type ModuleMatch = Pick<
  IntegrationModuleRow,
  'slug' | 'name' | 'description' | 'provider_slugs' | 'planned_provider_slugs' | 'setup_path'
>
type AppMatch = Pick<IntegrationApplication, 'module' | 'offers' | 'hostSlug' | 'name' | 'description'>
type TranslateFn = (key: string, opts?: { defaultValue?: string }) => string

const REMOTE_MCP_SLUGS = new Set(REMOTE_MCP_PROVIDERS.map((p) => p.slug))

/** Provider slugs behind an application, across every offer it exposes. */
function providerSlugs(app: AppMatch): string[] {
  return app.offers
    .map((offer) => offerProviderSlug(offer))
    .filter((slug): slug is string => Boolean(slug))
}

/** Canonical platform slug for one marketplace offer. */
export function offerProviderSlug(offer: IntegrationOffer): string {
  return (
    offer.provider?.slug ||
    offer.registry?.platformSlug ||
    STATIC_ID_TO_SLUG[offer.integration.id] ||
    offer.integration.id
  )
}

/**
 * Does this module run on this application? True when the catalog tagged the app
 * with the module, or when the module lists one of the app's providers.
 */
export function moduleUsesApplication(module: ModuleMatch, app: AppMatch): boolean {
  if (app.module && app.module === module.slug) return true
  const slugs = providerSlugs(app)
  const live = module.provider_slugs ?? []
  const planned = module.planned_provider_slugs ?? []
  return live.some((slug) => slugs.includes(slug)) || planned.some((slug) => slugs.includes(slug))
}

/** Partner applications a module can run on, in catalog order. */
export function applicationsForModule<T extends IntegrationApplication>(
  applications: readonly T[],
  module: ModuleMatch,
): T[] {
  return applications.filter((app) => moduleUsesApplication(module, app))
}

/** Modules that can use this connection, so a dialog can point at them. */
export function modulesForApplication<T extends IntegrationModuleRow>(
  modules: readonly T[],
  app: AppMatch | null,
): T[] {
  if (!app) return []
  return modules.filter((module) => moduleUsesApplication(module, app))
}

/**
 * Provider slugs that connect only through a module (native API / partner MCP),
 * not as standalone marketplace cards. Remote hosted MCPs stay in the catalog
 * even when a module also lists them as planned.
 */
export function modulePackageProviderSlugs(modules: readonly ModuleMatch[]): Set<string> {
  const out = new Set<string>()
  for (const mod of modules) {
    for (const slug of mod.provider_slugs ?? []) out.add(slug)
    for (const slug of mod.planned_provider_slugs ?? []) {
      if (!REMOTE_MCP_SLUGS.has(slug)) out.add(slug)
    }
  }
  return out
}

export function isModulePackageOffer(
  offer: IntegrationOffer,
  packageSlugs: Set<string>,
): boolean {
  return packageSlugs.has(offerProviderSlug(offer))
}

/** Marketplace / Connected strip: every offer except module-only packages. */
export function marketplaceOfferRows(
  apps: readonly IntegrationApplication[],
  modules: readonly ModuleMatch[],
): ApplicationOfferRow[] {
  const packageSlugs = modulePackageProviderSlugs(modules)
  return flattenApplicationOffers([...apps]).filter(
    (row) => !isModulePackageOffer(row.offer, packageSlugs),
  )
}

/** Module that owns a package slug, if any (for deep links like ?connect=moneybird). */
export function moduleForPackageSlug<T extends ModuleMatch>(
  modules: readonly T[],
  slug: string,
): T | null {
  const trimmed = slug.trim()
  if (!trimmed) return null
  const packageSlugs = modulePackageProviderSlugs(modules)
  if (!packageSlugs.has(trimmed)) return null
  return (
    modules.find((mod) => {
      const live = mod.provider_slugs ?? []
      const planned = mod.planned_provider_slugs ?? []
      return live.includes(trimmed) || planned.includes(trimmed)
    }) ?? null
  )
}

export function modulePackageConnectPath(
  modules: readonly ModuleMatch[],
  slug: string,
): string | null {
  const mod = moduleForPackageSlug(modules, slug)
  if (!mod) return null
  return moduleHomePath(mod)
}

/** Search: module name/description, or any partner host / package name. */
export function moduleMatchesMarketplaceQuery(
  module: ModuleMatch,
  applications: readonly IntegrationApplication[],
  query: string,
  t: TranslateFn,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const name = t(`integrations.modules.${module.slug}.name`, { defaultValue: module.name })
  const description = t(`integrations.modules.${module.slug}.description`, {
    defaultValue: module.description,
  })
  if (`${name} ${description}`.toLowerCase().includes(q)) return true
  if ((module.provider_slugs ?? []).some((slug) => slug.toLowerCase().includes(q))) return true
  if ((module.planned_provider_slugs ?? []).some((slug) => slug.toLowerCase().includes(q))) return true
  for (const app of applicationsForModule(applications, module)) {
    const host = localizeApplication(app, t)
    if (host.name.toLowerCase().includes(q) || host.description.toLowerCase().includes(q)) {
      return true
    }
    for (const offer of app.offers) {
      const copy = localizeOfferCopy(offer, t)
      if (
        copy.name.toLowerCase().includes(q) ||
        copy.description.toLowerCase().includes(q) ||
        offerProviderSlug(offer).toLowerCase().includes(q)
      ) {
        return true
      }
    }
  }
  return false
}
