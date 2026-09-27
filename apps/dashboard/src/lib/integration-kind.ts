import { REMOTE_MCP_SLUGS } from './mcp-remote-providers'

export type IntegrationKind = 'inbox' | 'repository' | 'mcp' | 'calendar' | 'app'

const APP_SLUGS = new Set(['moneybird', 'exact_online', 'snelstart', 'gocardless_bank'])

const MCP_SLUGS = new Set([
  'king_accountancy',
  'bjorn_lunden_mcp',
  'alpaca_mcp',
  'custom_mcp',
  'shopify_mcp',
  'pmb_exact_mcp',
  'yuki_mcp',
  ...REMOTE_MCP_SLUGS,
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
  capabilities?: Record<string, boolean | string[] | undefined>,
): IntegrationKind {
  const slug = normalizeSlug(slugOrId)
  if (capabilities?.calendar === true) return 'calendar'
  if (capabilities?.mcp_tools === true || capabilities?.remote_mcp === true) return 'mcp'
  if (capabilities?.accounting === true || APP_SLUGS.has(slug)) return 'app'
  if (capabilities?.inbox_sync === true) return 'inbox'
  if (capabilities?.repo_index === true) return 'repository'
  if (CALENDAR_SLUGS.has(slug) || slug.includes('calendar')) return 'calendar'
  if (MCP_SLUGS.has(slug) || slug.includes('mcp')) return 'mcp'
  if (REPOSITORY_SLUGS.has(slug)) return 'repository'
  if (INBOX_SLUGS.has(slug)) return 'inbox'
  if (slug.includes('github') || slug.includes('gitlab')) return 'repository'
  return 'app'
}

export function getManagePath(kind: IntegrationKind): string {
  switch (kind) {
    case 'repository':
      return '/connections?kind=repository'
    case 'inbox':
      return '/connections?kind=inbox'
    case 'calendar':
      return '/agenda'
    case 'mcp':
      return '/connections?kind=mcp'
    case 'app':
      return '/connections?kind=app'
  }
}
