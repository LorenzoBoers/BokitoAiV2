import { resolveProviderRowBrand } from './integration-brand'
import {
  installMcpIntegration,
  listIntegrationConnections,
  listIntegrationProviders,
  listMcpBindings,
  revokeIntegrationConnection,
  type IntegrationConnectionRow,
  type IntegrationProviderRow,
  type ProvidersListResponse,
} from './integrations-api'
import { PROVIDER_REGISTRY } from './integrations/registry'
import { withTimeout } from './promise-timeout'

const MCP_CONNECTIONS_TIMEOUT_MS = 15_000

/** Default Xano MCP server ids per provider slug (see registry `mcpServerId`). */
export const MCP_PROVIDER_SERVER_IDS: Record<string, number> = Object.fromEntries(
  PROVIDER_REGISTRY.filter((e) => e.mcpServerId != null).map((e) => [e.platformSlug, e.mcpServerId!]),
)

export type McpAuthType = 'api_key' | 'bearer'

export type McpIntegrationRow = {
  id: string
  providerSlug: string
  providerName: string
  displayName: string
  endpoint: string
  authLabel: McpAuthType
  status: IntegrationConnectionRow['status']
  mcpServerId?: string | number
  createdAt?: string
  logoUrl?: string | null
  logoDarkUrl?: string | null
  initials: string
  brandColor: string
  hostSlug?: string | null
}

export type InstallMcpConnectionInput = {
  provider: string
  api_key: string
  display_name?: string
  server_url?: string
  auth_type?: McpAuthType
}

function isMcpProvider(provider: IntegrationProviderRow): boolean {
  return provider.capabilities?.mcp_tools === true
}

export async function listMcpProviders(): Promise<IntegrationProviderRow[]> {
  const { providers } = await listIntegrationProviders()
  return providers.filter(isMcpProvider)
}

function authTypeFromMetadata(
  metadata?: Record<string, unknown>,
  providerAuth?: string,
): McpAuthType {
  if (providerAuth === 'mcp_remote_oauth') return 'bearer'
  const raw = metadata?.auth_type
  return raw === 'bearer' ? 'bearer' : 'api_key'
}

function endpointForRow(
  provider: IntegrationProviderRow,
  connection: IntegrationConnectionRow,
  bindingConfig?: Record<string, unknown>,
): string {
  if (provider.slug === 'custom_mcp') {
    const url =
      (connection.metadata?.server_url as string | undefined) ??
      (bindingConfig?.server_url as string | undefined)
    return url ?? ''
  }
  if (provider.slug === 'bjorn_lunden_mcp') {
    return 'Bjorn Lunden MCP'
  }
  const remoteUrl =
    (connection.metadata?.mcp_remote_url as string | undefined) ??
    (bindingConfig?.mcp_remote_url as string | undefined)
  if (remoteUrl) return remoteUrl
  const url = bindingConfig?.server_url as string | undefined
  return url ?? provider.name
}

export type ListMcpIntegrationRowsOptions = {
  /** Skip a second providers list call when the caller already loaded it. */
  providersList?: ProvidersListResponse
}

export async function listMcpIntegrationRows(
  options?: ListMcpIntegrationRowsOptions,
): Promise<McpIntegrationRow[]> {
  const bindingsPromise = listMcpBindings().catch(() => ({
    bindings: [] as NonNullable<Awaited<ReturnType<typeof listMcpBindings>>['bindings']>,
    mcp_server_ids: [] as Array<number | string>,
  }))

  let providers: IntegrationProviderRow[]
  let bindings: Awaited<typeof bindingsPromise>

  if (options?.providersList) {
    providers = options.providersList.providers ?? []
    bindings = await bindingsPromise
  } else {
    const [providersResult, bindingsResult] = await Promise.all([
      listIntegrationProviders().catch(
        (): ProvidersListResponse => ({
          providers: [],
          hosts: [],
          connection_counts: {
            by_provider_id: {},
            email_outlook: 0,
            email_gmail: 0,
          },
        }),
      ),
      bindingsPromise,
    ])
    providers = providersResult.providers ?? []
    bindings = bindingsResult
  }

  const mcpProviders = providers.filter(isMcpProvider)
  const providerById = new Map(mcpProviders.map((p) => [p.id, p]))

  const bindingByConnectionId = new Map<string, (typeof bindings.bindings)[number]>()
  for (const b of bindings.bindings ?? []) {
    if (b.connection_id) {
      bindingByConnectionId.set(b.connection_id, b)
    }
  }

  const connectionLists = await withTimeout(
    Promise.all(
      mcpProviders.map((p) =>
        listIntegrationConnections(p.slug).catch(() => [] as IntegrationConnectionRow[]),
      ),
    ),
    MCP_CONNECTIONS_TIMEOUT_MS,
    mcpProviders.map(() => [] as IntegrationConnectionRow[]),
  )

  const rows: McpIntegrationRow[] = []

  for (const connections of connectionLists) {
    for (const connection of connections) {
      if (connection.status === 'revoked') continue
      const provider = providerById.get(connection.provider_id)
      if (!provider) continue

      const binding = bindingByConnectionId.get(connection.id)
      const bindingConfig = binding?.config as Record<string, unknown> | undefined
      const mcpServerId = bindingConfig?.mcp_server_id

      const brand = resolveProviderRowBrand(provider)
      rows.push({
        id: connection.id,
        providerSlug: provider.slug,
        providerName: provider.name,
        displayName: connection.display_name,
        endpoint: endpointForRow(provider, connection, bindingConfig),
        authLabel: authTypeFromMetadata(connection.metadata, provider.auth_type),
        status: connection.status,
        mcpServerId: mcpServerId != null ? mcpServerId : undefined,
        createdAt: connection.created_at,
        logoUrl: brand.logoUrl,
        logoDarkUrl: brand.logoDarkUrl,
        initials: brand.initials,
        brandColor: brand.color,
        hostSlug: brand.hostSlug,
      })
    }
  }

  rows.sort((a, b) => {
    const ta = a.createdAt ?? ''
    const tb = b.createdAt ?? ''
    return tb.localeCompare(ta)
  })

  return rows
}

export async function installMcpConnection(input: InstallMcpConnectionInput): Promise<void> {
  const mcpServerId = MCP_PROVIDER_SERVER_IDS[input.provider]
  await installMcpIntegration({
    provider: input.provider,
    api_key: input.api_key,
    display_name: input.display_name,
    server_url: input.server_url,
    auth_type: input.auth_type,
    ...(mcpServerId != null ? { mcp_server_id: mcpServerId } : {}),
  })
}

export async function revokeMcpConnection(connectionId: string): Promise<void> {
  await revokeIntegrationConnection(connectionId)
}
