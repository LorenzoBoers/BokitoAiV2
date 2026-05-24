import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import type { Integration } from '../../data/integrations-data'
import { resolveIntegrationKind } from '../../lib/integration-kind'
import type { IntegrationKind } from '../../lib/integration-kind'
import { IntegrationHostLogo } from './IntegrationHostLogo'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'

type ProviderCardProps = {
  integration: Integration
  connectionCount: number
  onSetup: () => void
  onViewConnected: () => void
  onSetupInMcp?: () => void
  onAddAccount?: () => void
}

function kindLabelKey(kind: IntegrationKind): string {
  return `integrations.kind.${kind}`
}

export function ProviderCard({
  integration,
  connectionCount,
  onSetup,
  onViewConnected,
  onSetupInMcp,
  onAddAccount,
}: ProviderCardProps) {
  const { t } = useTranslation('nav')
  const kind = integration.kind ?? resolveIntegrationKind(integration.id)
  const isConnected = connectionCount > 0
  const isComingSoon = integration.status === 'coming_soon'
  const isMcp = kind === 'mcp'
  const showAddAccount = kind === 'repository' && isConnected && onAddAccount != null

  return (
    <article className="flex flex-col rounded-xl border border-border/60 bg-bg-surface p-5 transition-shadow hover:shadow-sm hover:border-border">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="text-sm font-semibold text-text-heading">{integration.name}</h3>
            <Badge variant="neutral" className="text-[10px] font-medium uppercase tracking-wide">
              {t(kindLabelKey(kind))}
            </Badge>
          </div>
          <p className="text-xs text-text-secondary line-clamp-2 leading-relaxed">
            {integration.description}
          </p>
          {isConnected ? (
            <p className="text-[11px] text-text-muted mt-2">
              {t('integrations.marketplace.activeConnections', { count: connectionCount })}
            </p>
          ) : null}
        </div>
        <IntegrationHostLogo
          logoUrl={integration.logoUrl}
          logoDarkUrl={integration.logoDarkUrl}
          initials={integration.initials}
          color={integration.color}
          name={integration.name}
          hostSlug={integration.hostSlug}
          size="md"
        />
      </div>

      <div className="mt-4 pt-4 border-t border-border/50 flex items-center justify-end gap-2 flex-wrap">
        {isComingSoon ? (
          <Button size="sm" variant="secondary" disabled className="gap-1.5">
            <Clock size={12} />
            {t('integrations.actions.comingSoon')}
          </Button>
        ) : isConnected ? (
          <>
            {showAddAccount ? (
              <Button size="sm" variant="ghost" onClick={onAddAccount}>
                {t('integrations.actions.addAccount')}
              </Button>
            ) : null}
            {isMcp && onSetupInMcp ? (
              <Button size="sm" variant="ghost" onClick={onSetupInMcp}>
                {t('integrations.actions.manageInMcp')}
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={onViewConnected}>
              {t('integrations.actions.viewInConnected')}
            </Button>
          </>
        ) : isMcp && onSetupInMcp ? (
          <Button size="sm" onClick={onSetupInMcp}>
            {t('integrations.actions.setupInMcp')}
          </Button>
        ) : (
          <Button size="sm" onClick={onSetup}>
            {t('integrations.actions.setupConnection')}
          </Button>
        )}
      </div>
    </article>
  )
}
