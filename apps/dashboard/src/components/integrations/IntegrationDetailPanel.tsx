import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import type { Integration } from '../../data/integrations-data'
import {
  listMcpServers,
  testMcpServer,
  type IntegrationProviderRow,
  type McpServerRow,
} from '../../lib/integrations-api'
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
  /** Extra context above the actions, e.g. the modules that use this login. */
  children?: ReactNode
}

function kindLabelKey(kind: IntegrationKind): string {
  return `integrations.kind.${kind}`
}

function serversForProvider(
  servers: McpServerRow[],
  providerSlug: string | undefined,
): McpServerRow[] {
  if (!providerSlug) return []
  return servers.filter((s) => s.provider === providerSlug && s.is_active !== false)
}

export function IntegrationDetailPanel({
  integration,
  provider,
  connectionCount,
  banner,
  onSetup,
  onViewConnected,
  onAddAccount,
  children,
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
  const isMcp = Boolean(
    provider?.capabilities?.mcp_tools || remoteEndpoint || registryEntry?.setupMode === 'custom_mcp'
      || registryEntry?.setupMode === 'remote_mcp_oauth' || kind === 'mcp',
  )

  const [servers, setServers] = useState<McpServerRow[]>([])
  const [toolsBusy, setToolsBusy] = useState(false)
  const [toolsError, setToolsError] = useState<string | null>(null)

  const loadServers = useCallback(async () => {
    if (!isMcp || !isConnected || !provider?.slug) {
      setServers([])
      return
    }
    try {
      const rows = await listMcpServers()
      setServers(serversForProvider(rows, provider.slug))
      setToolsError(null)
    } catch {
      setServers([])
      setToolsError(
        t('integrations.hub.detail.toolsLoadError', {
          defaultValue: 'Could not load MCP tools.',
        }),
      )
    }
  }, [isConnected, isMcp, provider?.slug, t])

  useEffect(() => {
    void loadServers()
  }, [loadServers])

  const refreshTools = async () => {
    const target = servers[0]
    if (!target) return
    setToolsBusy(true)
    setToolsError(null)
    try {
      const result = await testMcpServer(target.id)
      setServers((prev) =>
        prev.map((s) =>
          s.id === target.id
            ? {
                ...s,
                tools: result.tools ?? [],
                tools_synced_at: new Date().toISOString(),
              }
            : s,
        ),
      )
      if (!result.ok && result.error) {
        setToolsError(result.error)
      }
    } catch {
      setToolsError(
        t('integrations.hub.detail.toolsRefreshError', {
          defaultValue: 'Could not refresh tools from the MCP server.',
        }),
      )
    } finally {
      setToolsBusy(false)
    }
  }

  const toolNames = servers.flatMap((s) =>
    (s.tools ?? [])
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        server: s.name,
      }))
      .filter((tool) => Boolean(tool.name)),
  )

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

      {isMcp ? (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              {t('integrations.hub.detail.tools', { defaultValue: 'Tools' })}
            </p>
            {isConnected && servers.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-[11px]"
                disabled={toolsBusy}
                onClick={() => void refreshTools()}
              >
                <RefreshCw className={`h-3 w-3 ${toolsBusy ? 'animate-spin' : ''}`} aria-hidden />
                {t('integrations.hub.detail.refreshTools', { defaultValue: 'Refresh' })}
              </Button>
            ) : null}
          </div>
          {!isConnected ? (
            <p className="text-xs text-text-muted">
              {t('integrations.hub.detail.toolsAfterConnect', {
                defaultValue: 'Exact MCP tool paths appear after you connect this integration.',
              })}
            </p>
          ) : toolsError ? (
            <p className="text-xs text-status-error">{toolsError}</p>
          ) : toolNames.length === 0 ? (
            <p className="text-xs text-text-muted">
              {t('integrations.hub.detail.toolsEmpty', {
                defaultValue: 'No tools synced yet. Refresh to discover tools from the MCP server.',
              })}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {toolNames.map((tool) => (
                <li key={`${tool.server}-${tool.name}`}>
                  <Badge
                    variant="neutral"
                    className="max-w-full font-mono text-[10px] font-normal"
                    title={tool.description || tool.name}
                  >
                    {tool.name}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {children}

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
