/** Canonical remote MCP OAuth provider definitions (platform seed). */
export type RemoteMcpProviderDef = {
  slug: string
  staticId: string
  name: string
  description: string
  category: 'Communication' | 'Development' | 'Productivity'
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
    description: 'Connect Notion workspaces for documents and knowledge bases via MCP.',
    category: 'Productivity',
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
    description: 'Issues, projects, and comments from Linear for agents.',
    category: 'Productivity',
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
    description: 'Jira, Confluence, and Compass via the Atlassian remote MCP server.',
    category: 'Productivity',
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
    description: 'Search, messages and channels in Slack via the official MCP server.',
    category: 'Communication',
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
    description: 'Tasks and projects in Asana via MCP v2.',
    category: 'Productivity',
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
    description: 'ClickUp workspaces and tasks for agent workflows.',
    category: 'Productivity',
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
    description: 'Issues, projects, and debugging context from Sentry.',
    category: 'Development',
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
    description: 'Stripe data and actions via the hosted MCP server.',
    category: 'Productivity',
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
    description: 'GitHub issues and PRs via remote MCP (alongside repository indexing).',
    category: 'Development',
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
    description: 'Entra and directory insights via Microsoft MCP Server for Enterprise (preview).',
    category: 'Communication',
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
    description: 'Generate AI images and videos (Sora, Veo, Kling, and more) via Higgsfield MCP.',
    category: 'Productivity',
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
