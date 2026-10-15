import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IntegrationHostLogo } from './IntegrationHostLogo'
import { ModuleInstallControls } from './ModuleInstallControls'
import { ModuleSpecialistCallout } from './ModuleSpecialistCallout'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { IconTile } from '../ui/icon-tile'
import {
  moduleHomePath,
  moduleIsOn,
  moduleNavIcon,
  resolveModuleToolCards,
} from '../../lib/integration-modules'
import { hostSlugForProvider, resolveHostBrand } from '../../lib/integration-brand'
import type { IntegrationApplication } from '../../lib/integration-applications'
import type { IntegrationModuleRow } from '../../lib/integrations-api'
import { cn } from '../../lib/utils'

function activeConnectionCount(applications: IntegrationApplication[]): number {
  return applications.reduce(
    (sum, app) => sum + app.offers.reduce((inner, offer) => inner + (offer.connectionCount || 0), 0),
    0,
  )
}


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
  return <IconTile icon={Icon} />

}

/** Marketplace and Connections hub share this card: install, manage, uninstall. */
export function MarketplaceModuleCard({
  module,
  applications,
  onAction,
  onOpenDetail,
  showKindBadge = false,
}: {
  module: IntegrationModuleRow
  applications: IntegrationApplication[]
  onAction: (slug: string, action: 'install' | 'complete_setup' | 'uninstall') => Promise<unknown>
  /** Opens the module showcase modal (card body click). */
  onOpenDetail?: () => void
  /** In a mixed grid next to integrations: label the card as a module. */
  showKindBadge?: boolean
}) {
  const { t } = useTranslation('nav')
  const name = t(`integrations.modules.${module.slug}.name`, { defaultValue: module.name })
  const description = t(`integrations.modules.${module.slug}.description`, {
    defaultValue: module.description,
  })
  const comingSoon = module.status === 'coming_soon'
  const planned = module.planned_provider_slugs ?? []
  const installed = moduleIsOn(module)
  const activeCount = activeConnectionCount(applications)
  const hasActive = activeCount > 0
  const clickable = Boolean(onOpenDetail) && !comingSoon
  const toolCount = resolveModuleToolCards(module).length
  const tagCount = module.package?.tags?.length ?? 0

  return (
    <article
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={() => {
        if (clickable) onOpenDetail?.()
      }}
      onKeyDown={(e) => {
        if (!clickable) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpenDetail?.()
        }
      }}
      className={cn(
        'panel flex h-full flex-col p-4',
        comingSoon
          ? 'pointer-events-none cursor-not-allowed opacity-50'
          : clickable
            ? 'hover-lift hover:border-border cursor-pointer'
            : null,
      )}
      aria-disabled={comingSoon || undefined}
    >
      <div className="flex items-start gap-3">
        <ModuleIcon slug={module.slug} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-text-heading">{name}</h3>
            {showKindBadge ? (
              <Badge variant="neutral" className="text-2xs font-medium">
                {t('integrations.modules.kindBadge', { defaultValue: 'Module' })}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-snug text-text-secondary">
            {description}
          </p>
          {(toolCount > 0 || tagCount > 0) && !comingSoon ? (
            <p className="mt-1.5 text-2xs text-text-muted">
              {[
                toolCount > 0
                  ? t('integrations.modules.showcase.cardTools', {
                      count: toolCount,
                      defaultValue: '{{count}} agent tools',
                    })
                  : null,
                tagCount > 0
                  ? t('integrations.modules.showcase.cardTags', {
                      count: tagCount,
                      defaultValue: '{{count}} hashtags',
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-3">
        <ModuleSpecialistCallout module={module} moduleName={name} compact />
      </div>
      <div className="mt-3 flex flex-1 items-end justify-between gap-3 border-t border-border/50 pt-3">
        <div className="min-w-0 space-y-2">
          <ModulePartnerLogos applications={applications} extraHostSlugs={planned} />
          <p
            className={cn(
              'text-xs',
              hasActive ? 'font-medium text-accent' : 'text-text-muted',
            )}
          >
            {hasActive
              ? t('integrations.card.activeConnections', {
                  count: activeCount,
                  defaultValue: '{{count}} active connections',
                })
              : installed
                ? t('integrations.card.noConnectionsYet', {
                    defaultValue: 'No connections yet',
                  })
                : t('integrations.card.notInstalledYet', {
                    defaultValue: 'Not installed yet',
                  })}
          </p>
        </div>
        <div
          className="flex shrink-0 items-center gap-2"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {comingSoon ? null : installed || hasActive ? (
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
