export type IntegrationKind = 'inbox' | 'repository' | 'mcp' | 'calendar'

const MCP_SLUGS = new Set([
  'king_accountancy',
  'bjorn_lunden_mcp',
  // Accounting-module connections surface in the agent-tools lane.
  'moneybird',
  'exact_online',
  'snelstart',
  'custom_mcp',
  'notion_mcp',
  'linear_mcp',
  'atlassian_mcp',
  'slack_mcp',
  'asana_mcp',
  'clickup_mcp',
  'sentry_mcp',
  'stripe_mcp',
  'shopify_mcp',
  'github_mcp',
  'microsoft_graph_mcp',
  'higgsfield_mcp',
])
const REPOSITORY_SLUGS = new Set(['github', 'gitlab'])
const CALENDAR_SLUGS = new Set(['google_calendar', 'outlook_calendar', 'google-calendar', 'outlook-calendar'])
const INBOX_SLUGS = new Set([
  'outlook',
  'gmail',
  'microsoft-365',
  'google-workspace',
  'microsoft_mail',
  'google_mail',
  'whatsapp',
  'ms-teams',
  'twilio',
])

function normalizeSlug(slugOrId: string): string {
  return slugOrId.trim().toLowerCase()
}

export function resolveIntegrationKind(
  slugOrId: string,
  capabilities?: Record<string, boolean>,
): IntegrationKind {
  const slug = normalizeSlug(slugOrId)
  if (capabilities?.calendar) return 'calendar'
  if (capabilities?.mcp_tools || capabilities?.remote_mcp || capabilities?.accounting) return 'mcp'
  if (capabilities?.inbox_sync) return 'inbox'
  if (capabilities?.repo_index) return 'repository'
  if (CALENDAR_SLUGS.has(slug) || slug.includes('calendar')) return 'calendar'
  if (MCP_SLUGS.has(slug) || slug.includes('mcp')) return 'mcp'
  if (REPOSITORY_SLUGS.has(slug)) return 'repository'
  if (INBOX_SLUGS.has(slug)) return 'inbox'
  if (slug.includes('github') || slug.includes('gitlab')) return 'repository'
  return 'inbox'
}

export function getManagePath(kind: IntegrationKind): string {
  switch (kind) {
    case 'repository':
      return '/modules/connected?kind=repository'
    case 'inbox':
      return '/modules/connected?kind=inbox'
    case 'calendar':
      return '/agenda'
    case 'mcp':
      return '/modules/tools'
  }
}
