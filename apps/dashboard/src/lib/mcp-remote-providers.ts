/** Canonical remote MCP OAuth provider definitions (mirrors Xano seed). */
export type RemoteMcpProviderDef = {
  slug: string
  staticId: string
  name: string
  description: string
  category: 'Communicatie' | 'Ontwikkeling' | 'Productiviteit'
  mcpRemoteUrl: string
  mcpTransport: 'streamable_http' | 'sse'
  oauthConfigKey: string
  popular?: boolean
  wave: 1 | 2 | 3
  /** UI status when OAuth env is not configured on platform. */
  defaultStatus: 'available' | 'coming_soon'
}

export const REMOTE_MCP_PROVIDERS: RemoteMcpProviderDef[] = [
  {
    slug: 'notion_mcp',
    staticId: 'notion',
    name: 'Notion',
    description: 'Koppel Notion-workspaces voor documenten en kennisbanken via MCP.',
    category: 'Productiviteit',
    mcpRemoteUrl: 'https://mcp.notion.com/mcp',
    mcpTransport: 'streamable_http',
    oauthConfigKey: 'NOTION_MCP',
    popular: true,
    wave: 1,
    defaultStatus: 'coming_soon',
  },
  {
    slug: 'linear_mcp',
    staticId: 'linear',
    name: 'Linear',
    description: 'Issues, projecten en comments uit Linear voor agents.',
    category: 'Productiviteit',
    mcpRemoteUrl: 'https://mcp.linear.app/mcp',
    mcpTransport: 'streamable_http',
    oauthConfigKey: 'LINEAR_MCP',
    popular: true,
    wave: 1,
    defaultStatus: 'coming_soon',
  },
  {
    slug: 'atlassian_mcp',
    staticId: 'atlassian',
    name: 'Atlassian Rovo',
    description: 'Jira, Confluence en Compass via de Atlassian remote MCP-server.',
    category: 'Productiviteit',
    mcpRemoteUrl: 'https://mcp.atlassian.com/v1/mcp/authv2',
    mcpTransport: 'streamable_http',
    oauthConfigKey: 'ATLASSIAN_MCP',
    popular: true,
    wave: 1,
    defaultStatus: 'coming_soon',
  },
  {
    slug: 'slack_mcp',
    staticId: 'slack',
    name: 'Slack',
    description: 'Zoeken, berichten en kanalen in Slack via de officiële MCP-server.',
    category: 'Communicatie',
    mcpRemoteUrl: 'https://mcp.slack.com/mcp',
    mcpTransport: 'streamable_http',
    oauthConfigKey: 'SLACK_MCP',
    popular: true,
    wave: 1,
    defaultStatus: 'coming_soon',
  },
  {
    slug: 'asana_mcp',
    staticId: 'asana',
    name: 'Asana',
    description: 'Taken en projecten in Asana via MCP v2.',
    category: 'Productiviteit',
    mcpRemoteUrl: 'https://mcp.asana.com/v2/mcp',
    mcpTransport: 'streamable_http',
    oauthConfigKey: 'ASANA_MCP',
    wave: 2,
    defaultStatus: 'coming_soon',
  },
  {
    slug: 'clickup_mcp',
    staticId: 'clickup',
    name: 'ClickUp',
    description: 'ClickUp-workspaces en taken voor agentworkflows.',
    category: 'Productiviteit',
    mcpRemoteUrl: 'https://mcp.clickup.com/mcp',
    mcpTransport: 'streamable_http',
    oauthConfigKey: 'CLICKUP_MCP',
    wave: 2,
    defaultStatus: 'coming_soon',
  },
  {
    slug: 'sentry_mcp',
    staticId: 'sentry',
    name: 'Sentry',
    description: 'Issues, projecten en debugging-context uit Sentry.',
    category: 'Ontwikkeling',
    mcpRemoteUrl: 'https://mcp.sentry.dev/mcp',
    mcpTransport: 'streamable_http',
    oauthConfigKey: 'SENTRY_MCP',
    wave: 2,
    defaultStatus: 'coming_soon',
  },
  {
    slug: 'stripe_mcp',
    staticId: 'stripe',
    name: 'Stripe',
    description: 'Stripe-data en acties via de hosted MCP-server.',
    category: 'Productiviteit',
    mcpRemoteUrl: 'https://mcp.stripe.com',
    mcpTransport: 'streamable_http',
    oauthConfigKey: 'STRIPE_MCP',
    wave: 2,
    defaultStatus: 'coming_soon',
  },
  {
    slug: 'github_mcp',
    staticId: 'github-mcp',
    name: 'GitHub MCP',
    description: 'GitHub issues en PRs via remote MCP (naast repository-indexering).',
    category: 'Ontwikkeling',
    mcpRemoteUrl: 'https://api.githubcopilot.com/mcp/',
    mcpTransport: 'streamable_http',
    oauthConfigKey: 'GITHUB_MCP',
    wave: 3,
    defaultStatus: 'coming_soon',
  },
  {
    slug: 'microsoft_graph_mcp',
    staticId: 'microsoft-graph-mcp',
    name: 'Microsoft Graph MCP',
    description: 'Entra en directory-inzichten via Microsoft MCP Server for Enterprise (preview).',
    category: 'Communicatie',
    mcpRemoteUrl: 'https://mcp.svc.cloud.microsoft/enterprise',
    mcpTransport: 'streamable_http',
    oauthConfigKey: 'MICROSOFT_GRAPH_MCP',
    wave: 3,
    defaultStatus: 'coming_soon',
  },
  {
    slug: 'higgsfield_mcp',
    staticId: 'higgsfield',
    name: 'Higgsfield',
    description: 'Genereer AI-beelden en -video\'s (Sora, Veo, Kling en meer) via Higgsfield MCP.',
    category: 'Productiviteit',
    mcpRemoteUrl: 'https://mcp.higgsfield.ai/mcp',
    mcpTransport: 'streamable_http',
    oauthConfigKey: 'HIGGSFIELD_MCP',
    wave: 2,
    defaultStatus: 'coming_soon',
  },
]

export const REMOTE_MCP_SLUGS = REMOTE_MCP_PROVIDERS.map((p) => p.slug)

export function remoteMcpBySlug(slug: string): RemoteMcpProviderDef | undefined {
  return REMOTE_MCP_PROVIDERS.find((p) => p.slug === slug)
}

export function remoteMcpByStaticId(staticId: string): RemoteMcpProviderDef | undefined {
  return REMOTE_MCP_PROVIDERS.find((p) => p.staticId === staticId)
}
