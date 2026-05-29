#!/usr/bin/env node
/**
 * Seed integration_hosts and integration_providers (idempotent upsert via Metadata API).
 *
 * Usage: node scripts/seed-integration-providers.mjs
 *
 * Requires XANO_METADATA_API_KEY in .env.
 * See xano-patches/v1/integration-hosts-seed.md and integration-providers-seed.md.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1)]
    }),
)

const WORKSPACE_ID = 1

const CORE_HOSTS = [
  { id: 'b2000001-0000-4000-8000-000000000001', slug: 'github', name: 'GitHub', website_url: 'https://github.com', sort_order: 10, brand_color: '#24292f', initials: 'GH' },
  { id: 'b2000001-0000-4000-8000-000000000002', slug: 'microsoft', name: 'Microsoft', website_url: 'https://microsoft.com', sort_order: 20, brand_color: '#0078d4', initials: 'MS' },
  { id: 'b2000001-0000-4000-8000-000000000003', slug: 'google', name: 'Google', website_url: 'https://google.com', sort_order: 30, brand_color: '#4285f4', initials: 'GO' },
  { id: 'b2000001-0000-4000-8000-000000000004', slug: 'bjorn_lunden', name: 'Bjorn Lunden', website_url: 'https://bjornlunden.com', sort_order: 40, brand_color: '#0f766e', initials: 'BL' },
  { id: 'b2000001-0000-4000-8000-000000000005', slug: 'custom', name: 'Custom', sort_order: 50, brand_color: '#475569', initials: 'MC' },
  { id: 'b2000001-0000-4000-8000-000000000006', slug: 'smtp', name: 'SMTP', sort_order: 60, brand_color: '#64748b', initials: 'SM' },
  { id: 'b2000001-0000-4000-8000-000000000007', slug: 'notion', name: 'Notion', website_url: 'https://notion.so', sort_order: 70, brand_color: '#000000', initials: 'NO' },
  { id: 'b2000001-0000-4000-8000-000000000008', slug: 'linear', name: 'Linear', website_url: 'https://linear.app', sort_order: 80, brand_color: '#5e6ad2', initials: 'LN' },
  { id: 'b2000001-0000-4000-8000-000000000009', slug: 'atlassian', name: 'Atlassian', website_url: 'https://atlassian.com', sort_order: 90, brand_color: '#0052cc', initials: 'AT' },
  { id: 'b2000001-0000-4000-8000-00000000000a', slug: 'slack', name: 'Slack', website_url: 'https://slack.com', sort_order: 100, brand_color: '#4a154b', initials: 'SL' },
  { id: 'b2000001-0000-4000-8000-00000000000b', slug: 'asana', name: 'Asana', website_url: 'https://asana.com', sort_order: 110, brand_color: '#f06a6a', initials: 'AS' },
  { id: 'b2000001-0000-4000-8000-00000000000c', slug: 'clickup', name: 'ClickUp', website_url: 'https://clickup.com', sort_order: 120, brand_color: '#7b68ee', initials: 'CU' },
  { id: 'b2000001-0000-4000-8000-00000000000d', slug: 'sentry', name: 'Sentry', website_url: 'https://sentry.io', sort_order: 130, brand_color: '#362d59', initials: 'SE' },
  { id: 'b2000001-0000-4000-8000-00000000000e', slug: 'stripe', name: 'Stripe', website_url: 'https://stripe.com', sort_order: 140, brand_color: '#635bff', initials: 'ST' },
  { id: 'b2000001-0000-4000-8000-00000000000f', slug: 'shopify', name: 'Shopify', website_url: 'https://shopify.com', sort_order: 150, brand_color: '#96bf48', initials: 'SH' },
]

const CORE_PROVIDERS = [
  {
    id: 'a1000001-0000-4000-8000-000000000001',
    slug: 'github',
    name: 'GitHub',
    description: 'Connect repositories for code-aware agents.',
    category: 'DevTools',
    auth_type: 'oauth2',
    status: 'available',
    oauth_config_key: 'GITHUB_OAUTH',
    host_id: 'b2000001-0000-4000-8000-000000000001',
    capabilities: { repo_sync: true },
    sort_order: 10,
    logo_meta: { initials: 'GH', color: '#24292f' },
  },
  {
    id: 'a1000001-0000-4000-8000-000000000002',
    slug: 'outlook',
    name: 'Outlook',
    description: 'Sync Microsoft 365 mailboxes for inbox agents.',
    category: 'Communication',
    auth_type: 'oauth2',
    status: 'available',
    oauth_config_key: 'MICROSOFT',
    host_id: 'b2000001-0000-4000-8000-000000000002',
    capabilities: { inbox_sync: true },
    sort_order: 20,
    logo_meta: { initials: 'OL', color: '#0078d4' },
  },
  {
    id: 'a1000001-0000-4000-8000-000000000003',
    slug: 'gmail',
    name: 'Gmail',
    description: 'Sync Google Workspace mail for inbox agents.',
    category: 'Communication',
    auth_type: 'oauth2',
    status: 'available',
    oauth_config_key: 'GOOGLE',
    host_id: 'b2000001-0000-4000-8000-000000000003',
    capabilities: { inbox_sync: true },
    sort_order: 30,
    logo_meta: { initials: 'GM', color: '#ea4335' },
  },
  {
    id: 'a1000001-0000-4000-8000-000000000004',
    slug: 'bjorn_lunden_mcp',
    name: 'Bjorn Lunden MCP',
    description: 'Accounting data via Bjorn Lunden MCP server.',
    category: 'Finance',
    auth_type: 'api_key',
    status: 'available',
    host_id: 'b2000001-0000-4000-8000-000000000004',
    capabilities: { mcp_tools: true },
    sort_order: 40,
    logo_meta: { initials: 'BL', color: '#1a365d' },
  },
  {
    id: 'a1000001-0000-4000-8000-000000000005',
    slug: 'custom_mcp',
    name: 'Custom MCP',
    description: 'Connect any external MCP server by URL and API key or bearer token.',
    category: 'Productivity',
    auth_type: 'api_key',
    status: 'available',
    host_id: 'b2000001-0000-4000-8000-000000000005',
    capabilities: { mcp_tools: true, custom: true },
    sort_order: 50,
    logo_meta: { initials: 'MC', color: '#6366f1' },
  },
]

function metaBase() {
  return (env.XANO_META_BASE_URL || 'https://xrex-nmji-j9ur.f2.xano.io/api:meta').replace(/\/$/, '')
}

function authHeaders() {
  return {
    Authorization: `Bearer ${env.XANO_METADATA_API_KEY}`,
    'Content-Type': 'application/json',
  }
}

async function findTableId(name) {
  const url = `${metaBase()}/workspace/${WORKSPACE_ID}/table?search=${encodeURIComponent(name)}`
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) throw new Error(`table search failed: ${res.status}`)
  const data = await res.json()
  const items = data?.items ?? data ?? []
  const row = items.find((t) => t.name === name)
  if (!row) throw new Error(`Table "${name}" not found in workspace ${WORKSPACE_ID}`)
  return row.id
}

async function listExistingSlugs(tableId) {
  const url = `${metaBase()}/workspace/${WORKSPACE_ID}/table/${tableId}/content?page=1&per_page=500`
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) return new Set()
  const data = await res.json()
  const items = data?.items ?? []
  return new Set(items.map((r) => r.slug).filter(Boolean))
}

async function upsertRow(tableId, row, label) {
  const url = `${metaBase()}/workspace/${WORKSPACE_ID}/table/${tableId}/content/bulk`
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ items: [row], allow_id_field: true }),
  })
  if (res.status === 200 || res.status === 201) {
    console.log(`  added ${label}`)
    return
  }
  const text = await res.text()
  if (/duplicate|unique|already exists/i.test(text)) {
    const patchUrl = `${metaBase()}/workspace/${WORKSPACE_ID}/table/${tableId}/content/${row.id}`
    const patchRes = await fetch(patchUrl, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify(row),
    })
    if (patchRes.ok) {
      console.log(`  updated ${label}`)
      return
    }
    console.warn(`  skip ${label}: ${(await patchRes.text()).slice(0, 120)}`)
    return
  }
  console.warn(`  failed ${label}: ${res.status} ${text.slice(0, 200)}`)
}

async function main() {
  if (!env.XANO_METADATA_API_KEY) {
    console.error('XANO_METADATA_API_KEY missing in .env')
    process.exit(1)
  }

  console.log('Resolving integration_hosts table...')
  const hostsTableId = await findTableId('integration_hosts')
  console.log(`Hosts table id: ${hostsTableId}`)

  const existingHosts = await listExistingSlugs(hostsTableId)
  console.log(`Existing host slugs: ${existingHosts.size}`)

  console.log('Seeding integration_hosts...')
  for (const host of CORE_HOSTS) {
    await upsertRow(hostsTableId, host, host.slug)
  }

  console.log('Resolving integration_providers table...')
  const providersTableId = await findTableId('integration_providers')
  console.log(`Providers table id: ${providersTableId}`)

  const existingProviders = await listExistingSlugs(providersTableId)
  console.log(`Existing provider slugs: ${existingProviders.size}`)

  console.log('Seeding integration_providers...')
  for (const provider of CORE_PROVIDERS) {
    await upsertRow(providersTableId, provider, provider.slug)
  }

  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
