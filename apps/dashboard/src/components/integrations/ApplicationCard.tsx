import { useTranslation } from 'react-i18next'
import { Clock, Info } from 'lucide-react'
import {
  localizeOfferCopy,
  type IntegrationApplication,
  type IntegrationOffer,
} from '../../lib/integration-applications'
import { IntegrationHostLogo } from './IntegrationHostLogo'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'

type Props = {
  application: IntegrationApplication
  offer: IntegrationOffer
  onOpenDetail: () => void
}

export function ApplicationCard({ application, offer, onOpenDetail }: Props) {
  const { t } = useTranslation('nav')
  const copy = localizeOfferCopy(offer, t)
  const isComingSoon = offer.integration.status === 'coming_soon'
  const isConnected = offer.connectionCount > 0

  return (
    <article
      role={isComingSoon ? undefined : 'button'}
      tabIndex={isComingSoon ? undefined : 0}
      onClick={() => {
        if (!isComingSoon) onOpenDetail()
      }}
      onKeyDown={(e) => {
        if (isComingSoon) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpenDetail()
        }
      }}
      className={cn(
        'flex flex-col rounded-lg border border-border/60 bg-bg-surface p-5',
        isComingSoon
          ? 'pointer-events-none cursor-not-allowed opacity-50'
          : 'hover-lift hover:border-border cursor-pointer',
      )}
      aria-disabled={isComingSoon || undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="text-sm font-semibold text-text-heading">{copy.name}</h3>
            {application.module ? null : (
              <Badge variant="neutral" className="text-2xs font-medium">
                {t(`integrations.kind.${offer.kind}`)}
              </Badge>
            )}
          </div>
          <p className="text-xs text-text-secondary line-clamp-2 leading-relaxed">{copy.description}</p>
        </div>
        <IntegrationHostLogo
          logoUrl={application.brand.logoUrl}
          logoDarkUrl={application.brand.logoDarkUrl}
          initials={application.brand.initials}
          color={application.brand.color}
          name={copy.name}
          hostSlug={application.brand.hostSlug}
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
            {t('integrations.actions.connectAnother')}
            <span className="ml-1.5 text-2xs text-text-muted">
              {t('integrations.application.alreadyCount', { count: offer.connectionCount })}
            </span>
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
