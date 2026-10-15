import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
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
  const isMcp = offer.kind === 'mcp'

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
        'panel flex h-full flex-col p-5',
        isComingSoon
          ? 'pointer-events-none cursor-not-allowed opacity-50'
          : 'hover-lift hover:border-border cursor-pointer',
      )}
      aria-disabled={isComingSoon || undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-text-heading">{copy.name}</h3>
            {isMcp ? (
              <Badge variant="neutral" className="text-2xs font-medium">
                {t('integrations.kindBadge.mcp', { defaultValue: 'MCP' })}
              </Badge>
            ) : application.module ? null : (
              <Badge variant="neutral" className="text-2xs font-medium">
                {t(`integrations.kind.${offer.kind}`)}
              </Badge>
            )}
          </div>
          <p className="line-clamp-2 text-xs leading-relaxed text-text-secondary">{copy.description}</p>
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

      <div className="mt-4 flex flex-1 items-end justify-between gap-3 border-t border-border/60 pt-4">
        <p
          className={cn(
            'min-w-0 text-xs',
            isConnected ? 'font-medium text-accent' : 'text-text-muted',
          )}
        >
          {isConnected
            ? t('integrations.card.activeConnections', {
                count: offer.connectionCount,
                defaultValue: '{{count}} active connections',
              })
            : t('integrations.card.notInstalledYet', {
                defaultValue: 'Not installed yet',
              })}
        </p>
        {isComingSoon ? (
          <Button size="sm" variant="secondary" disabled className="gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <Clock size={14} />
            {t('integrations.actions.comingSoon')}
          </Button>
        ) : isConnected ? (
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              onOpenDetail()
            }}
          >
            {t('integrations.actions.manage')}
          </Button>
        ) : (
          <Button
            size="sm"
            className="shrink-0"
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
