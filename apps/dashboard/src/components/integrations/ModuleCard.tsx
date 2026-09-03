import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IntegrationHostLogo } from './IntegrationHostLogo'
import { ModuleInstallControls } from './ModuleInstallControls'
import { ModuleStatusBadge } from './ModuleStatusBadge'
import {
  moduleHomePath,
  moduleIsOn,
  moduleNavIcon,
  plannedProviderLabel,
} from '../../lib/integration-modules'
import type { IntegrationApplication } from '../../lib/integration-applications'
import type { IntegrationModuleRow } from '../../lib/integrations-api'
import { cn } from '../../lib/utils'

const MAX_PARTNER_LOGOS = 4

/** Partner logos of the programs a module can run on, overlapped like avatars. */
export function ModulePartnerLogos({
  applications,
  className,
}: {
  applications: IntegrationApplication[]
  className?: string
}) {
  if (applications.length === 0) return null
  const shown = applications.slice(0, MAX_PARTNER_LOGOS)
  const overflow = applications.length - shown.length

  return (
    <span className={cn('flex items-center', className)} aria-hidden>
      {shown.map((app, index) => (
        <span
          key={app.hostSlug}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-full border-2 border-bg-surface bg-bg-elevated',
            index > 0 && '-ml-2',
          )}
          style={{ zIndex: shown.length - index }}
        >
          <IntegrationHostLogo
            logoUrl={app.brand.logoUrl}
            logoDarkUrl={app.brand.logoDarkUrl}
            initials={app.brand.initials}
            color={app.brand.color}
            name={app.name}
            hostSlug={app.brand.hostSlug}
            size="sm"
          />
        </span>
      ))}
      {overflow > 0 ? (
        <span className="-ml-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-bg-surface bg-bg-elevated text-[10px] font-medium tabular-nums text-text-muted">
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

/** Installed-zone card on the Connections hub: what this workspace runs on. */
export function InstalledModuleCard({
  module,
  applications,
}: {
  module: IntegrationModuleRow
  applications: IntegrationApplication[]
}) {
  const { t } = useTranslation('nav')
  const name = t(`integrations.modules.${module.slug}.name`, { defaultValue: module.name })
  const description = t(`integrations.modules.${module.slug}.description`, {
    defaultValue: module.description,
  })
  const attached = module.attached_connection_count ?? 0

  return (
    <Link
      to={moduleHomePath(module)}
      className="flex gap-3 rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card transition-colors hover:border-accent/40 hover:bg-bg-hover/30"
    >
      <ModuleIcon slug={module.slug} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-text-heading">{name}</span>
          <ModuleStatusBadge module={module} />
        </span>
        <span className="mt-1 line-clamp-2 block text-[12.5px] leading-snug text-text-secondary">
          {description}
        </span>
        <span className="mt-3 flex items-center justify-between gap-3">
          <ModulePartnerLogos applications={applications} />
          <span className="text-[11px] tabular-nums text-text-muted">
            {t('integrations.modules.attachedCount', {
              defaultValue: '{{count}} connections',
              count: attached,
            })}
          </span>
        </span>
      </span>
    </Link>
  )
}

/** Marketplace module card: install or open a preset, never a partner login. */
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
  const planned = applications.length === 0 ? module.planned_provider_slugs : []

  return (
    <article className="flex h-full flex-col rounded-xl border border-border/60 bg-bg-elevated/40 p-4 shadow-card">
      <div className="flex items-start gap-3">
        <ModuleIcon slug={module.slug} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-text-heading">{name}</h3>
            <ModuleStatusBadge module={module} />
          </div>
          <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-text-secondary">
            {description}
          </p>
        </div>
      </div>
      {planned.length > 0 ? (
        <p className="mt-3 text-[11px] leading-snug text-text-muted">
          {t('integrations.modules.planned', {
            defaultValue: 'Planned connectors: {{providers}}',
            providers: planned.map(plannedProviderLabel).join(', '),
          })}
        </p>
      ) : null}
      <div className="mt-4 flex flex-1 items-end justify-between gap-2 border-t border-border/50 pt-3">
        <ModulePartnerLogos applications={applications} />
        <div className="flex items-center gap-2">
          {comingSoon ? null : <ModuleInstallControls module={module} onAction={onAction} compact />}
          {comingSoon ? null : (
            <Link
              to={moduleHomePath(module)}
              className="text-xs font-medium text-accent hover:underline"
            >
              {moduleIsOn(module)
                ? t('integrations.modules.manageCta', { defaultValue: 'Manage {{name}}', name })
                : t('integrations.modules.setupCta', { defaultValue: 'View {{name}}', name })}
            </Link>
          )}
        </div>
      </div>
    </article>
  )
}
