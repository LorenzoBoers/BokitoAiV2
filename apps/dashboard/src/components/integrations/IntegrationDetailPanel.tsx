import { useTranslation } from 'react-i18next'
import type { Integration } from '../../data/integrations-data'
import type { IntegrationProviderRow } from '../../lib/integrations-api'
import { capabilityLabels } from '../../lib/integration-setup'
import { remoteMcpByStaticId } from '../../lib/mcp-remote-providers'
import { getRegistryEntryByStaticId } from '../../lib/integrations/registry'
import { resolveIntegrationKind, type IntegrationKind } from '../../lib/integration-kind'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'

type HubBanner = { type: 'success' | 'error'; message: string } | null

type Props = {
  integration: Integration
  provider?: IntegrationProviderRow | null
  connectionCount: number
  banner: HubBanner
  onSetup: () => void
  onViewConnected: () => void
  onAddAccount?: () => void
}

function kindLabelKey(kind: IntegrationKind): string {
  return `integrations.kind.${kind}`
}

export function IntegrationDetailPanel({
  integration,
  provider,
  connectionCount,
  banner,
  onSetup,
  onViewConnected,
  onAddAccount,
}: Props) {
  const { t } = useTranslation('nav')
  const kind = integration.kind ?? resolveIntegrationKind(integration.id)
  const isConnected = connectionCount > 0
  const isComingSoon = integration.status === 'coming_soon'
  const caps = capabilityLabels(provider, integration)
  const showAddAccount = kind === 'repository' && isConnected && onAddAccount != null
  const remoteDef = remoteMcpByStaticId(integration.id)
  const registryEntry = getRegistryEntryByStaticId(integration.id)
  const remoteEndpoint =
    provider?.mcp_remote_url ?? registryEntry?.mcpRemoteUrl ?? remoteDef?.mcpRemoteUrl

  return (
    <div className="space-y-4">
      {banner ? (
        <p
          className={`text-xs rounded-md px-3 py-2 border ${
            banner.type === 'success'
              ? 'border-status-success/30 bg-status-success/10 text-status-success'
              : 'border-status-error/30 bg-status-error/10 text-status-error'
          }`}
        >
          {banner.message}
        </p>
      ) : null}

      <p className="text-sm text-text-secondary leading-relaxed">{integration.description}</p>

      {remoteEndpoint ? (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">
            {t('integrations.hub.setup.remoteMcpEndpoint')}
          </p>
          <p className="text-[11px] font-mono text-text-muted break-all">{remoteEndpoint}</p>
        </div>
      ) : null}

      {isComingSoon && remoteDef ? (
        <p className="text-xs text-text-muted border border-border/60 rounded-md px-3 py-2">
          {t('integrations.hub.setup.comingSoonRemoteMcp')}
        </p>
      ) : null}

      {caps.length > 0 ? (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2">
            {t('integrations.hub.detail.capabilities')}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {caps.map((cap) => (
              <Badge key={cap} variant="neutral" className="text-[10px]">
                {t(`integrations.hub.capability.${cap}`, { defaultValue: cap })}
              </Badge>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Badge variant="neutral" className="text-[10px] uppercase tracking-wide">
          {t(kindLabelKey(kind))}
        </Badge>
        {isConnected ? (
          <span className="text-xs text-text-muted">
            {t('integrations.marketplace.activeConnections', { count: connectionCount })}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 pt-2">
        {isComingSoon ? (
          <Button size="sm" variant="secondary" disabled>
            {t('integrations.actions.comingSoon')}
          </Button>
        ) : isConnected ? (
          <>
            {showAddAccount ? (
              <Button size="sm" variant="ghost" onClick={onAddAccount}>
                {t('integrations.actions.addAccount')}
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={onViewConnected}>
              {t('integrations.hub.detail.manageConnected')}
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={onSetup}>
            {t('integrations.hub.detail.setup')}
          </Button>
        )}
      </div>
    </div>
  )
}
