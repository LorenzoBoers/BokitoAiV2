import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { IntegrationHostLogo } from './IntegrationHostLogo'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { plannedProviderLabel } from '../../lib/integration-modules'
import { HOST_STATIC_BRAND_META } from '../../lib/integration-brand'
import { BRAND_ASSETS } from '../../lib/brand-assets'
import type { IntegrationApplication } from '../../lib/integration-applications'
import { cn } from '../../lib/utils'

export type ModulePackageItem = {
  key: string
  name: string
  description?: string
  hostSlug: string
  logoUrl?: string | null
  logoDarkUrl?: string | null
  initials: string
  color: string
  status: 'available' | 'connected' | 'coming_soon'
  connectionCount?: number
  application?: IntegrationApplication
  providerSlug?: string
}

type Props = {
  items: ModulePackageItem[]
  onOpen?: (item: ModulePackageItem) => void
  className?: string
}

/** Live + planned packages for a module as one card grid. */
export function ModulePackageGrid({ items, onOpen, className }: Props) {
  const { t } = useTranslation('nav')
  if (items.length === 0) return null

  return (
    <ul className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {items.map((item) => {
        const planned = item.status === 'coming_soon'
        const connected = item.status === 'connected' || (item.connectionCount ?? 0) > 0
        return (
          <li key={item.key}>
            <article
              className={cn(
                'flex h-full flex-col rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card',
                planned && 'opacity-70',
                !planned && onOpen && 'cursor-pointer hover:border-accent/40',
              )}
              onClick={() => {
                if (!planned && onOpen) onOpen(item)
              }}
              onKeyDown={(e) => {
                if (planned || !onOpen) return
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onOpen(item)
                }
              }}
              role={!planned && onOpen ? 'button' : undefined}
              tabIndex={!planned && onOpen ? 0 : undefined}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="text-sm font-semibold text-text-heading">{item.name}</h3>
                    {planned ? (
                      <Badge variant="neutral" className="text-[10px]">
                        {t('integrations.modules.plannedBadge', { defaultValue: 'Planned' })}
                      </Badge>
                    ) : connected ? (
                      <Badge variant="success" className="text-[10px]">
                        {t('integrations.modules.integrationOn', { defaultValue: 'On' })}
                      </Badge>
                    ) : (
                      <Badge variant="neutral" className="text-[10px]">
                        {t('integrations.modules.integrationOff', { defaultValue: 'Optional' })}
                      </Badge>
                    )}
                  </div>
                  {item.description ? (
                    <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{item.description}</p>
                  ) : null}
                </div>
                <IntegrationHostLogo
                  logoUrl={item.logoUrl}
                  logoDarkUrl={item.logoDarkUrl}
                  initials={item.initials}
                  color={item.color}
                  name={item.name}
                  hostSlug={item.hostSlug}
                  size="md"
                />
              </div>
              <div className="mt-3 flex justify-end border-t border-border/50 pt-3">
                {planned ? (
                  <Button type="button" size="sm" variant="secondary" disabled className="gap-1.5">
                    <Clock size={14} aria-hidden />
                    {t('integrations.actions.comingSoon', { defaultValue: 'Coming soon' })}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant={connected ? 'secondary' : 'default'}
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpen?.(item)
                    }}
                  >
                    {connected
                      ? t('integrations.application.manage', { defaultValue: 'Manage' })
                      : t('integrations.actions.setupConnection', { defaultValue: 'Connect' })}
                  </Button>
                )}
              </div>
            </article>
          </li>
        )
      })}
    </ul>
  )
}

/** Build grid items from live apps + planned provider slugs. */
export function buildModulePackageItems(
  apps: IntegrationApplication[],
  plannedSlugs: string[],
  providersBySlug?: Map<string, { name: string; hostSlug: string; description?: string }>,
): ModulePackageItem[] {
  const live = apps
    .filter((app) => app.status !== 'coming_soon')
    .map((app) => ({
      key: `live-${app.hostSlug}`,
      name: app.name,
      description: app.description,
      hostSlug: app.brand.hostSlug ?? app.hostSlug,
      logoUrl: app.brand.logoUrl,
      logoDarkUrl: app.brand.logoDarkUrl,
      initials: app.brand.initials,
      color: app.brand.color,
      status: ((app.connectionCount ?? 0) > 0 || app.status === 'connected'
        ? 'connected'
        : 'available') as ModulePackageItem['status'],
      connectionCount: app.connectionCount,
      application: app,
      providerSlug: app.offers[0]?.integration.id,
    }))

  const liveHostSlugs = new Set(live.map((i) => i.hostSlug))
  const liveProviderIds = new Set(
    apps.flatMap((a) => a.offers.map((o) => o.integration.id)),
  )

  const planned = plannedSlugs
    .filter((slug) => !liveProviderIds.has(slug))
    .map((slug) => {
      const meta = providersBySlug?.get(slug)
      const hostSlug = meta?.hostSlug ?? slug.replace(/_mcp$/, '').replace(/_online$/, '')
      if (liveHostSlugs.has(hostSlug)) return null
      const name = meta?.name ?? plannedProviderLabel(slug)
      const brand = BRAND_ASSETS[hostSlug]
      const metaBrand = HOST_STATIC_BRAND_META[hostSlug]
      const initials =
        metaBrand?.initials ??
        name
          .split(/\s+/)
          .map((w) => w[0])
          .join('')
          .slice(0, 2)
          .toUpperCase()
      return {
        key: `planned-${slug}`,
        name,
        description: meta?.description,
        hostSlug,
        logoUrl: brand?.logoUrl ?? null,
        logoDarkUrl: brand?.logoDarkUrl ?? null,
        initials: initials || 'PL',
        color: metaBrand?.color ?? '#6b7280',
        status: 'coming_soon' as const,
        providerSlug: slug,
      }
    })
    .filter(Boolean) as ModulePackageItem[]

  // Also include coming_soon apps already in the catalog application list.
  const soonApps = apps
    .filter((app) => app.status === 'coming_soon')
    .filter((app) => !planned.some((p) => p.hostSlug === app.brand.hostSlug))
    .map((app) => ({
      key: `soon-${app.hostSlug}`,
      name: app.name,
      description: app.description,
      hostSlug: app.brand.hostSlug ?? app.hostSlug,
      logoUrl: app.brand.logoUrl,
      logoDarkUrl: app.brand.logoDarkUrl,
      initials: app.brand.initials,
      color: app.brand.color,
      status: 'coming_soon' as const,
      application: app,
      providerSlug: app.offers[0]?.integration.id,
    }))

  return [...live, ...soonApps, ...planned]
}
