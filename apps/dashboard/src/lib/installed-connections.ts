import type { CalendarConnection } from './calendars-api'
import type { EmailConnection } from './email-api'
import type { GithubConnectionRow } from './github-api'
import type { ResolvedIntegrationBrand } from './integration-brand'
import { hostSlugForProvider, resolveProviderBrand } from './integration-brand'
import type { IntegrationKind } from './integration-kind'
import type { ConnectedSummaryConnection } from './integrations-api'
import type { McpIntegrationRow } from './mcp-integrations'
import { programHeading } from './connection-list'

export type InstalledConnectionStatus = 'ready' | 'error' | 'needs_attention' | 'active'

/** One registration the operator can manage on Installed (cards or list). */
export type InstalledConnectionRow = {
  id: string
  /** Provider / program slug used to open the hub or module. */
  programKey: string
  programName: string
  /** Instance label: administration name, mailbox, login. */
  title: string
  subtitle: string | null
  kind: IntegrationKind
  status: InstalledConnectionStatus
  brand: ResolvedIntegrationBrand
  attachedModules: string[]
  eligibleModule: string | null
  instanceKey: string | null
  /** Where Manage should go when the panel is not enough. */
  manageHref: string | null
  source: 'summary' | 'mcp' | 'calendar' | 'github' | 'inbox'
  connectionId: string
}

export type BuildInstalledConnectionsInput = {
  connections: ConnectedSummaryConnection[]
  mcpRows: McpIntegrationRow[]
  calendarRows: CalendarConnection[]
  github: GithubConnectionRow[]
  mailboxes: EmailConnection[]
}

function statusFromSummary(status: string): InstalledConnectionStatus {
  if (status === 'error') return 'error'
  if (status === 'active') return 'ready'
  return 'needs_attention'
}

function statusFromCalendar(row: CalendarConnection): InstalledConnectionStatus {
  if (row.sync_status === 'reconnect' || row.status === 'error') return 'error'
  if (row.sync_status === 'error') return 'needs_attention'
  return 'ready'
}

function statusFromMailbox(row: EmailConnection): InstalledConnectionStatus {
  if (row.status === 'error' || row.status === 'needs_auth') return 'error'
  if (row.status === 'paused' || row.status === 'revoked') return 'needs_attention'
  return 'ready'
}

function brandFor(provider: string, name?: string): ResolvedIntegrationBrand {
  return resolveProviderBrand(provider, null, undefined, name)
}

/**
 * Flatten every active registration into one row per login / administration.
 * Multiple King or Moneybird accounts stay separate rows under the same program.
 */
export function buildInstalledConnectionRows(
  input: BuildInstalledConnectionsInput,
): InstalledConnectionRow[] {
  const rows: InstalledConnectionRow[] = []
  const summaryIds = new Set(input.connections.map((c) => c.id))

  for (const conn of input.connections) {
    const provider = conn.provider || conn.provider_id
    const brand = brandFor(provider, conn.display_name)
    const programName = programHeading(brand.name, conn.display_name)
    const instanceKey =
      typeof conn.instance_key === 'string'
        ? conn.instance_key
        : typeof conn.metadata?.instance_key === 'string'
          ? (conn.metadata.instance_key as string)
          : null
    const identity =
      typeof conn.metadata?.identity === 'string'
        ? (conn.metadata.identity as string)
        : typeof conn.external_account_id === 'string'
          ? conn.external_account_id
          : null
    rows.push({
      id: `summary:${conn.id}`,
      programKey: provider,
      programName,
      title: conn.display_name || programName,
      subtitle: identity && identity !== conn.display_name ? identity : null,
      kind: conn.kind,
      status: statusFromSummary(conn.status),
      brand: { ...brand, hostSlug: hostSlugForProvider(provider) },
      attachedModules: conn.attached_modules ?? [],
      eligibleModule: conn.eligible_module ?? null,
      instanceKey,
      manageHref: null,
      source: 'summary',
      connectionId: conn.id,
    })
  }

  for (const row of input.mcpRows) {
    if (summaryIds.has(row.id)) continue
    const brand = brandFor(row.providerSlug, row.providerName)
    rows.push({
      id: `mcp:${row.id}`,
      programKey: row.providerSlug,
      programName: row.providerName,
      title: row.displayName,
      subtitle: row.endpoint || null,
      kind: 'mcp',
      status: row.status === 'error' ? 'error' : row.status === 'active' ? 'ready' : 'needs_attention',
      brand: {
        ...brand,
        logoUrl: row.logoUrl ?? brand.logoUrl,
        logoDarkUrl: row.logoDarkUrl ?? brand.logoDarkUrl,
        hostSlug: row.hostSlug ?? brand.hostSlug,
      },
      attachedModules: [],
      eligibleModule: null,
      instanceKey: null,
      manageHref: null,
      source: 'mcp',
      connectionId: row.id,
    })
  }

  for (const row of input.calendarRows) {
    const brand = brandFor(row.provider, row.display_name)
    rows.push({
      id: `calendar:${row.id}`,
      programKey: row.provider,
      programName: brand.name,
      title: row.display_name,
      subtitle: row.account && row.account !== row.display_name ? row.account : null,
      kind: 'calendar',
      status: statusFromCalendar(row),
      brand,
      attachedModules: [],
      eligibleModule: null,
      instanceKey: null,
      manageHref: '/agenda',
      source: 'calendar',
      connectionId: row.id,
    })
  }

  for (const row of input.github) {
    if (row.status === 'revoked') continue
    const brand = brandFor('github', 'GitHub')
    rows.push({
      id: `github:${row.id}`,
      programKey: 'github',
      programName: 'GitHub',
      title: row.display_name || row.github_login,
      subtitle: row.github_login !== row.display_name ? row.github_login : null,
      kind: 'repository',
      status: row.status === 'error' ? 'error' : 'ready',
      brand,
      attachedModules: [],
      eligibleModule: null,
      instanceKey: null,
      manageHref: null,
      source: 'github',
      connectionId: row.id,
    })
  }

  for (const row of input.mailboxes) {
    if (row.status === 'revoked') continue
    const brand = brandFor(row.provider, row.displayName)
    rows.push({
      id: `inbox:${row.uuid ?? row.id}`,
      programKey: row.provider,
      programName: brand.name,
      title: row.displayName || row.mailboxEmail,
      subtitle: row.mailboxEmail !== row.displayName ? row.mailboxEmail : null,
      kind: 'inbox',
      status: statusFromMailbox(row),
      brand,
      attachedModules: [],
      eligibleModule: null,
      instanceKey: null,
      manageHref: '/settings/channels',
      source: 'inbox',
      connectionId: String(row.uuid ?? row.id),
    })
  }

  return rows.sort((a, b) => {
    const byProgram = a.programName.localeCompare(b.programName, undefined, { sensitivity: 'base' })
    if (byProgram !== 0) return byProgram
    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  })
}

export function filterInstalledConnections(
  rows: InstalledConnectionRow[],
  opts: { kind?: IntegrationKind | 'all'; query?: string },
): InstalledConnectionRow[] {
  const kind = opts.kind ?? 'all'
  const q = (opts.query ?? '').trim().toLowerCase()
  return rows.filter((row) => {
    if (kind !== 'all' && row.kind !== kind) return false
    if (!q) return true
    const hay = [
      row.programName,
      row.title,
      row.subtitle ?? '',
      row.instanceKey ?? '',
      row.kind,
      ...row.attachedModules,
    ]
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
}

/** Group rows by program so cards can show “2 King administrations” or one card per login. */
export function groupInstalledByProgram(rows: InstalledConnectionRow[]): Array<{
  programKey: string
  programName: string
  brand: ResolvedIntegrationBrand
  kind: IntegrationKind
  items: InstalledConnectionRow[]
}> {
  const map = new Map<string, ReturnType<typeof groupInstalledByProgram>[number]>()
  for (const row of rows) {
    let group = map.get(row.programKey)
    if (!group) {
      group = {
        programKey: row.programKey,
        programName: row.programName,
        brand: row.brand,
        kind: row.kind,
        items: [],
      }
      map.set(row.programKey, group)
    }
    group.items.push(row)
  }
  return [...map.values()].sort((a, b) =>
    a.programName.localeCompare(b.programName, undefined, { sensitivity: 'base' }),
  )
}
