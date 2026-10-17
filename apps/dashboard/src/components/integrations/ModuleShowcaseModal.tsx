import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IntegrationHostLogo } from './IntegrationHostLogo'
import { ModuleInstallControls } from './ModuleInstallControls'
import { ModulePartnerLogos } from './ModuleCard'
import { ModuleSpecialistCallout } from './ModuleSpecialistCallout'
import { ModuleToolsetPanel } from './ModuleToolsetPanel'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { IconTile } from '../ui/icon-tile'
import { Hashtag } from '../ui/HashtagMark'
import { hostSlugForProvider, resolveHostBrand } from '../../lib/integration-brand'
import {
  moduleHomePath,
  moduleIsOn,
  moduleNavIcon,
  resolveModuleToolCards,
} from '../../lib/integration-modules'
import type { IntegrationApplication } from '../../lib/integration-applications'
import type { IntegrationModuleRow } from '../../lib/integrations-api'
import { cn } from '../../lib/utils'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  module: IntegrationModuleRow | null
  applications: IntegrationApplication[]
  onAction: (slug: string, action: 'install' | 'complete_setup' | 'uninstall') => Promise<unknown>
}

function partnerRows(applications: IntegrationApplication[], extraHostSlugs: string[]) {
  const fromApps = applications.map((app) => ({
    key: app.hostSlug,
    name: app.name,
    brand: app.brand,
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
      return { key: hostSlug, name: brand.name, brand }
    })
  return [...fromApps, ...extra]
}

/**
 * Showcase modal for one business module from the Connections grid: what it
 * does, which partners it runs on, specialist ownership, tools and labels.
 */
export function ModuleShowcaseModal({
  open,
  onOpenChange,
  module,
  applications,
  onAction,
}: Props) {
  const { t } = useTranslation('nav')
  const [spawnKey, setSpawnKey] = useState<string | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const moduleSlug = module?.slug ?? null
  useEffect(() => {
    if (!open || !moduleSlug) return
    setSpawnKey(`full-${moduleSlug}-${Date.now()}`)
    setToolsOpen(false)
  }, [open, moduleSlug])
  if (!module) return null

  const name = t(`integrations.modules.${module.slug}.name`, { defaultValue: module.name })
  const description = t(`integrations.modules.${module.slug}.description`, {
    defaultValue: module.description,
  })
  const capability = t(`integrations.modules.${module.slug}.capability`, {
    defaultValue: module.capability_summary || '',
  })
  const needsWhen = t(`integrations.modules.${module.slug}.needsWhen`, {
    defaultValue: module.needs_when || '',
  })
  const comingSoon = module.status === 'coming_soon'
  const installed = moduleIsOn(module)
  const planned = module.planned_provider_slugs ?? []
  const partners = partnerRows(applications, planned)
  const toolCards = resolveModuleToolCards(module)
  const hasAttachedTools = (module.attached_mcp_tools ?? []).some((row) => row?.server_id)
  const showTools = toolCards.length > 0 || hasAttachedTools
  const customerTools = toolCards.filter(
    (card) => card.exposure === 'customer' || card.exposure === 'both',
  )
  const packageTags = module.package?.tags ?? []
  const packageFlows = module.package?.playbooks ?? []
  const Icon = moduleNavIcon(module.slug)
  const home = moduleHomePath(module)
  const readCount = toolCards.filter((c) => c.kind === 'read').length
  const proposeCount = toolCards.filter((c) => c.kind === 'propose').length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:rounded-xl">
        <DialogHeader className="shrink-0 space-y-0 border-b border-border/60 px-6 py-5 pr-14 text-left">
          <div className="flex items-start gap-4">
            <IconTile icon={Icon} size="lg" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="text-xl">{name}</DialogTitle>
                <Badge variant="neutral" className="text-2xs font-medium">
                  {t('integrations.modules.kindBadge', { defaultValue: 'Module' })}
                </Badge>
                {installed ? (
                  <Badge variant="secondary" className="text-2xs font-medium">
                    {t('integrations.modules.showcase.installedBadge', {
                      defaultValue: 'Installed',
                    })}
                  </Badge>
                ) : null}
              </div>
              <DialogDescription>
                {t('integrations.modules.showcase.subtitle', {
                  defaultValue: 'Preset for a field of work: tools, partners and setup in one place.',
                })}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <div className="space-y-2">
            <p className="text-sm leading-relaxed text-text-secondary">{description}</p>
            {capability ? (
              <p className="text-sm leading-relaxed text-text-muted">{capability}</p>
            ) : null}
            {needsWhen ? (
              <p className="text-xs leading-relaxed text-text-muted">
                <span className="font-medium text-text-secondary">
                  {t('integrations.modules.showcase.when', { defaultValue: 'When to use' })}
                  {': '}
                </span>
                {needsWhen}
              </p>
            ) : null}
            {showTools ? (
              <p className="text-xs text-text-muted">
                {t('integrations.modules.showcase.toolCounts', {
                  defaultValue: '{{reads}} read · {{proposes}} need approval',
                  reads: readCount,
                  proposes: proposeCount,
                })}
              </p>
            ) : null}
          </div>

          <ModuleSpecialistCallout
            module={module}
            moduleName={name}
            spawnKey={spawnKey}
            onNavigate={() => onOpenChange(false)}
          />

          {partners.length > 0 ? (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-2xs font-semibold uppercase tracking-wide text-text-muted">
                  {t('integrations.modules.showcase.partners', {
                    defaultValue: 'Works with',
                  })}
                </h3>
                <ModulePartnerLogos applications={applications} extraHostSlugs={planned} />
              </div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {partners.map((partner) => (
                  <li
                    key={partner.key}
                    className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5"
                  >
                    <IntegrationHostLogo
                      logoUrl={partner.brand.logoUrl}
                      logoDarkUrl={partner.brand.logoDarkUrl}
                      initials={partner.brand.initials}
                      color={partner.brand.color}
                      name={partner.name}
                      hostSlug={partner.brand.hostSlug}
                      size="md"
                    />
                    <span className="min-w-0 truncate text-sm font-medium text-text-heading">
                      {t(`integrations.hosts.${partner.key}.name`, { defaultValue: partner.name })}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {packageTags.length > 0 || packageFlows.length > 0 ? (
            <section className="space-y-3">
              <h3 className="text-2xs font-semibold uppercase tracking-wide text-text-muted">
                {t('integrations.modules.showcase.labelsFlows', {
                  defaultValue: 'Labels & flows',
                })}
              </h3>
              <p className="text-xs text-text-secondary">
                {t('integrations.modules.showcase.labelsFlowsIntro', {
                  defaultValue:
                    'Hashtags and flows the specialist can file work on. Installing may add the default hashtag for you.',
                })}
              </p>
              {packageTags.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {packageTags.map((tag) => (
                    <li
                      key={tag.slug}
                      className="rounded-lg border border-border/60 px-2.5 py-1.5 text-xs"
                      title={tag.description}
                    >
                      <Hashtag name={tag.name} />
                    </li>
                  ))}
                </ul>
              ) : null}
              {packageFlows.length > 0 ? (
                <ul className="space-y-1.5">
                  {packageFlows.map((flow) => (
                    <li
                      key={flow.slug}
                      className="rounded-lg border border-border/60 px-3 py-2 text-sm text-text-secondary"
                    >
                      <span className="font-medium text-text-heading">#{flow.name}</span>
                      {flow.description ? (
                        <span className="mt-0.5 block text-xs text-text-muted">
                          {flow.description}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {installed ? (
                <Button asChild size="sm" variant="ghost" className="h-auto px-0 text-xs">
                  <Link to="/categories" onClick={() => onOpenChange(false)}>
                    {t('integrations.modules.showcase.openLabels', {
                      defaultValue: 'Open Labels',
                    })}
                  </Link>
                </Button>
              ) : null}
            </section>
          ) : null}

          {showTools ? (
            <section className="space-y-3">
              <h3 className="text-2xs font-semibold uppercase tracking-wide text-text-muted">
                {t('integrations.modules.showcase.tools', {
                  defaultValue: 'What agents can do',
                })}
              </h3>
              {customerTools.length > 0 ? (
                <p className="text-xs text-text-secondary">
                  {t('integrations.modules.showcase.webchatNote', {
                    defaultValue:
                      '{{count}} tools can also run in website chat when you enable them under the module Overview.',
                    count: customerTools.length,
                  })}
                </p>
              ) : null}
              {toolCards.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {toolCards.map((card) => (
                    <li
                      key={`${card.kind}-${card.verb}`}
                      className="rounded-md border border-border/60 px-2 py-1 text-xs text-text-secondary"
                    >
                      {t(`integrations.modules.tools.${module.slug}.${card.verb}.label`, {
                        defaultValue: card.label,
                      })}
                    </li>
                  ))}
                </ul>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-auto px-0 text-xs"
                onClick={() => setToolsOpen((open) => !open)}
              >
                {toolsOpen
                  ? t('integrations.modules.showcase.toolsLess', { defaultValue: 'Hide details' })
                  : t('integrations.modules.showcase.toolsMore', { defaultValue: 'Show details' })}
              </Button>
              {toolsOpen ? <ModuleToolsetPanel module={module} compact /> : null}
            </section>
          ) : null}
        </div>

        <div
          className={cn(
            'flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border/60 px-6 py-4',
          )}
        >
          {comingSoon ? (
            <Button type="button" size="sm" variant="secondary" disabled>
              {t('integrations.modules.comingSoon', { defaultValue: 'Coming soon' })}
            </Button>
          ) : (
            <>
              {installed ? (
                <Button asChild size="sm" variant="secondary">
                  <Link to={home} onClick={() => onOpenChange(false)}>
                    {t('integrations.modules.showcase.openModule', {
                      defaultValue: 'Open module',
                    })}
                  </Link>
                </Button>
              ) : null}
              <ModuleInstallControls
                module={module}
                onAction={async (slug, action) => {
                  await onAction(slug, action)
                  if (action === 'install' || action === 'complete_setup') {
                    onOpenChange(false)
                  }
                }}
              />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
