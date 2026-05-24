export type IntegrationKind = 'inbox' | 'repository' | 'mcp'

const MCP_SLUGS = new Set(['bjorn_lunden_mcp', 'custom_mcp'])
const REPOSITORY_SLUGS = new Set(['github', 'gitlab'])
const INBOX_SLUGS = new Set([
  'outlook',
  'gmail',
  'microsoft-365',
  'google-workspace',
  'microsoft_mail',
  'google_mail',
  'whatsapp',
  'slack',
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
  if (capabilities?.mcp_tools) return 'mcp'
  if (capabilities?.inbox_sync) return 'inbox'
  if (capabilities?.repo_index) return 'repository'
  if (MCP_SLUGS.has(slug) || slug.includes('mcp')) return 'mcp'
  if (REPOSITORY_SLUGS.has(slug)) return 'repository'
  if (INBOX_SLUGS.has(slug)) return 'inbox'
  if (slug.includes('github') || slug.includes('gitlab')) return 'repository'
  return 'inbox'
}

export function getManagePath(kind: IntegrationKind): string {
  switch (kind) {
    case 'repository':
      return '/integrations/connected?kind=repository'
    case 'inbox':
      return '/integrations/connected?kind=inbox'
    case 'mcp':
      return '/integrations/mcp'
  }
}
