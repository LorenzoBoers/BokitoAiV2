import type { IntegrationApplication } from './integration-applications'
import type { IntegrationModuleRow } from './integrations-api'

type ModuleMatch = Pick<IntegrationModuleRow, 'slug' | 'provider_slugs'>
type AppMatch = Pick<IntegrationApplication, 'module' | 'offers'>

/** Provider slugs behind an application, across every offer it exposes. */
function providerSlugs(app: AppMatch): string[] {
  return app.offers
    .map((offer) => offer.provider?.slug ?? offer.registry?.platformSlug ?? offer.integration.id)
    .filter((slug): slug is string => Boolean(slug))
}

/**
 * Does this module run on this application? True when the catalog tagged the app
 * with the module, or when the module lists one of the app's providers.
 */
export function moduleUsesApplication(module: ModuleMatch, app: AppMatch): boolean {
  if (app.module && app.module === module.slug) return true
  const slugs = providerSlugs(app)
  return module.provider_slugs.some((slug) => slugs.includes(slug))
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
