import { useTranslation } from 'react-i18next'
import { Clock, Info } from 'lucide-react'
import { localizeApplication, type IntegrationApplication } from '../../lib/integration-applications'
import { IntegrationHostLogo } from './IntegrationHostLogo'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'

type Props = {
  application: IntegrationApplication
  onOpenDetail: () => void
}

export function ApplicationCard({ application, onOpenDetail }: Props) {
  const { t } = useTranslation('nav')
  const localized = localizeApplication(application, t)
  const { brand, offers, connectionCount, status } = localized
  const isComingSoon = status === 'coming_soon'
  const isConnected = connectionCount > 0
  const offerCount = offers.length

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpenDetail}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpenDetail()
        }
      }}
      className="flex flex-col rounded-xl border border-border/60 bg-bg-surface p-5 shadow-card hover-lift hover:border-border cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="text-sm font-semibold text-text-heading">{localized.name}</h3>
            {offerCount > 1 ? (
              <Badge variant="neutral" className="text-[10px] font-medium">
                {t('integrations.application.offerCount', { count: offerCount })}
              </Badge>
            ) : application.module ? null : (
              <Badge variant="neutral" className="text-[10px] font-medium">
                {t(`integrations.kind.${offers[0].kind}`)}
              </Badge>
            )}
          </div>
          <p className="text-xs text-text-secondary line-clamp-2 leading-relaxed">
            {localized.description}
          </p>
        </div>
        <IntegrationHostLogo
          logoUrl={brand.logoUrl}
          logoDarkUrl={brand.logoDarkUrl}
          initials={brand.initials}
          color={brand.color}
          name={localized.name}
          hostSlug={brand.hostSlug}
          size="md"
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/60 pt-4">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary"
          onClick={(e) => {
            e.stopPropagation()
            onOpenDetail()
          }}
          aria-label={t('integrations.actions.viewInfo')}
        >
          <Info size={14} />
        </button>
        {isComingSoon ? (
          <Button size="sm" variant="secondary" disabled className="gap-1.5" onClick={(e) => e.stopPropagation()}>
            <Clock size={14} />
            {t('integrations.actions.comingSoon')}
          </Button>
        ) : isConnected ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={(e) => {
              e.stopPropagation()
              onOpenDetail()
            }}
          >
            {t('integrations.application.manage')}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onOpenDetail()
            }}
          >
            {t('integrations.actions.setupConnection')}
          </Button>
        )}
      </div>
    </article>
  )
}
