import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IntegrationHostLogo } from './IntegrationHostLogo'
import { ModuleInstallControls } from './ModuleInstallControls'
import { ModuleStatusBadge } from './ModuleStatusBadge'
import { Button } from '../ui/button'
import {
  moduleHomePath,
  moduleIsOn,
  moduleNavIcon,
} from '../../lib/integration-modules'
import { hostSlugForProvider, resolveHostBrand } from '../../lib/integration-brand'
import type { IntegrationApplication } from '../../lib/integration-applications'
import type { IntegrationModuleRow } from '../../lib/integrations-api'
import { cn } from '../../lib/utils'

const MAX_PARTNER_LOGOS = 4

/** Partner logos of the programs a module can run on, overlapped like avatars. */
export function ModulePartnerLogos({
  applications,
  extraHostSlugs = [],
  className,
}: {
  applications: IntegrationApplication[]
  extraHostSlugs?: string[]
  className?: string
}) {
  const fromApps = applications.map((app) => ({
    key: app.hostSlug,
    logoUrl: app.brand.logoUrl,
    logoDarkUrl: app.brand.logoDarkUrl,
    initials: app.brand.initials,
    color: app.brand.color,
    name: app.name,
    hostSlug: app.brand.hostSlug,
  }))
  const seen = new Set(fromApps.map((row) => row.key))
  const extra = extraHostSlugs
    .map((slug) => hostSlugForProvider(slug))
    .filter((hostSlug) => {
      if (seen.has(hostSlug)) return false
      seen.add(hostSlug)
      return true
    })
    .map((hostSlug) => {
      const brand = resolveHostBrand(hostSlug)
      return {
        key: hostSlug,
        logoUrl: brand.logoUrl,
        logoDarkUrl: brand.logoDarkUrl,
        initials: brand.initials,
        color: brand.color,
        name: brand.name,
        hostSlug: brand.hostSlug,
      }
    })
  const marks = [...fromApps, ...extra]
  if (marks.length === 0) return null
  const shown = marks.slice(0, MAX_PARTNER_LOGOS)
  const overflow = marks.length - shown.length

  return (
    <span className={cn('flex items-center', className)} aria-hidden>
      {shown.map((mark, index) => (
        <span
          key={mark.key}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-full border-2 border-bg-surface bg-bg-elevated',
            index > 0 && '-ml-2',
          )}
          style={{ zIndex: shown.length - index }}
        >
          <IntegrationHostLogo
            logoUrl={mark.logoUrl}
            logoDarkUrl={mark.logoDarkUrl}
            initials={mark.initials}
            color={mark.color}
            name={mark.name}
            hostSlug={mark.hostSlug}
            size="sm"
          />
        </span>
      ))}
      {overflow > 0 ? (
        <span className="-ml-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-bg-surface bg-bg-elevated text-2xs font-medium tabular-nums text-text-muted">
          +{overflow}
        </span>
      ) : null}
    </span>
  )
}

function ModuleIcon({ slug }: { slug: string }) {
  const Icon = moduleNavIcon(slug)
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-bg-elevated/70 text-text-secondary">
      <Icon size={17} aria-hidden />
    </span>
  )
}

/** Marketplace and Connections hub share this card: install, manage, uninstall. */
export function MarketplaceModuleCard({
  module,
  applications,
  onAction,
}: {
  module: IntegrationModuleRow
  applications: IntegrationApplication[]
  onAction: (slug: string, action: 'install' | 'complete_setup' | 'uninstall') => Promise<unknown>
}) {
  const { t } = useTranslation('nav')
  const name = t(`integrations.modules.${module.slug}.name`, { defaultValue: module.name })
  const description = t(`integrations.modules.${module.slug}.description`, {
    defaultValue: module.description,
  })
  const comingSoon = module.status === 'coming_soon'
  const planned = module.planned_provider_slugs ?? []

  return (
    <article
      className={cn(
        'flex h-full flex-col rounded-lg border border-border/60 bg-bg-elevated/40 p-4',
        comingSoon && 'pointer-events-none cursor-not-allowed opacity-50',
      )}
      aria-disabled={comingSoon || undefined}
    >
      <div className="flex items-start gap-3">
        <ModuleIcon slug={module.slug} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-text-heading">{name}</h3>
            <ModuleStatusBadge module={module} />
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-snug text-text-secondary">
            {description}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-1 items-end justify-between gap-2 border-t border-border/50 pt-3">
        <ModulePartnerLogos applications={applications} extraHostSlugs={planned} />
        <div className="flex items-center gap-2">
          {comingSoon ? null : moduleIsOn(module) ? (
            <Button asChild size="sm" variant="secondary">
              <Link to={moduleHomePath(module)}>
                {t('integrations.modules.manage', { defaultValue: 'Manage' })}
              </Link>
            </Button>
          ) : null}
          {comingSoon ? null : (
            <ModuleInstallControls module={module} onAction={onAction} compact />
          )}
        </div>
      </div>
    </article>
  )
}
