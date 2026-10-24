import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '../ui/button'
import { Pressable } from '../ui/pressable'
import { Avatar } from '../ui/avatar'
import { ModulePartnerLogos } from './ModuleCard'
import { moduleSpecialistVisual } from './ModuleSpecialistCallout'
import { applicationsForModule } from '../../lib/module-applications'
import { moduleIsOn } from '../../lib/integration-modules'
import type { IntegrationApplication } from '../../lib/integration-applications'
import type { IntegrationModuleRow } from '../../lib/integrations-api'
import { cn } from '../../lib/utils'

type Props = {
  modules: IntegrationModuleRow[]
  applications: IntegrationApplication[]
  onOpen: (module: IntegrationModuleRow) => void
  className?: string
}

/**
 * Featured strip for domain modules on Discover — one large slide at a time
 * with partner logos and Explore, so modules read as packages not catalog rows.
 */
export function ModuleShowcaseCarousel({ modules, applications, onOpen, className }: Props) {
  const { t } = useTranslation('nav')
  const slides = useMemo(
    () =>
      modules
        .filter((m) => m.status !== 'coming_soon')
        .sort((a, b) => {
          const rank = (m: IntegrationModuleRow) => (moduleIsOn(m) ? 0 : 1)
          return rank(a) - rank(b) || a.name.localeCompare(b.name)
        }),
    [modules],
  )
  const [index, setIndex] = useState(0)
  if (slides.length === 0) return null

  const safeIndex = ((index % slides.length) + slides.length) % slides.length
  const module = slides[safeIndex]
  const name = t(`integrations.modules.${module.slug}.name`, { defaultValue: module.name })
  const description = t(`integrations.modules.${module.slug}.description`, {
    defaultValue: module.description,
  })
  const specialist = moduleSpecialistVisual(module, name, t)
  const apps = applicationsForModule(applications, module)
  const installed = moduleIsOn(module)

  const go = (delta: number) => setIndex((i) => i + delta)

  return (
    <section className={cn('space-y-3', className)} aria-labelledby="module-showcase-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="module-showcase-heading" className="text-xs font-semibold text-text-muted">
          {t('integrations.moduleShowcase.title', { defaultValue: 'Modules' })}
        </h2>
        <p className="text-2xs text-text-muted">
          {t('integrations.moduleShowcase.count', {
            count: slides.length,
            defaultValue: '{{count}} packages',
          })}
        </p>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-border bg-bg-elevated">
        <div className="flex flex-col items-center gap-5 px-6 py-8 text-center sm:px-10 sm:py-10">
          <p className="text-2xs font-semibold uppercase tracking-wide text-text-muted">
            {installed
              ? t('integrations.modules.showcase.installedBadge', { defaultValue: 'Installed' })
              : t('integrations.moduleShowcase.curated', { defaultValue: 'Domain package' })}
          </p>
          <div className="flex flex-col items-center gap-2">
            <Avatar
              kind="agent"
              agent={specialist.avatar}
              size={48}
              mode="live"
              decorative
            />
            <h3 className="title-section text-text-heading">{name}</h3>
            <p className="max-w-lg text-sm text-text-secondary">{description}</p>
          </div>
          <ModulePartnerLogos applications={apps} extraHostSlugs={module.planned_provider_slugs} />
          <Button type="button" size="sm" onClick={() => onOpen(module)}>
            {t('integrations.moduleShowcase.explore', { defaultValue: 'Explore' })}
          </Button>
        </div>

        {slides.length > 1 ? (
          <>
            <Pressable
              type="button"
              onClick={() => go(-1)}
              className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-bg-surface text-text-secondary hover:text-text-heading"
              aria-label={t('integrations.moduleShowcase.prev', { defaultValue: 'Previous module' })}
            >
              <ChevronLeft size={16} aria-hidden />
            </Pressable>
            <Pressable
              type="button"
              onClick={() => go(1)}
              className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-bg-surface text-text-secondary hover:text-text-heading"
              aria-label={t('integrations.moduleShowcase.next', { defaultValue: 'Next module' })}
            >
              <ChevronRight size={16} aria-hidden />
            </Pressable>
            <div className="flex justify-center gap-1.5 pb-4" role="tablist" aria-label={t('integrations.moduleShowcase.dots', { defaultValue: 'Module slides' })}>
              {slides.map((slide, i) => (
                <Pressable
                  key={slide.slug}
                  type="button"
                  role="tab"
                  aria-selected={i === safeIndex}
                  className={cn(
                    'h-1.5 w-1.5 rounded-full transition-colors',
                    i === safeIndex ? 'bg-text-heading' : 'bg-border hover:bg-text-muted',
                  )}
                  onClick={() => setIndex(i)}
                  aria-label={t(`integrations.modules.${slide.slug}.name`, { defaultValue: slide.name })}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </section>
  )
}
