/** Connected channel accounts (webchat, Slack, ...) for the Channels rail. */

import { appRoutes } from '../api/routes/app.routes'
import { apiGet } from './api'

export type ChannelAccountRow = {
  id: string
  channel: string
  provider: string
  address: string
  displayName: string
  isEnabled: boolean
}

function normalizeAccount(row: unknown): ChannelAccountRow | null {
  if (!row || typeof row !== 'object') return null
  const raw = row as Record<string, unknown>
  const id = typeof raw.id === 'string' ? raw.id : ''
  if (!id) return null
  return {
    id,
    channel: typeof raw.channel === 'string' ? raw.channel : '',
    provider: typeof raw.provider === 'string' ? raw.provider : '',
    address: typeof raw.address === 'string' ? raw.address : '',
    displayName: typeof raw.display_name === 'string' ? raw.display_name : '',
    isEnabled: raw.is_enabled !== false,
  }
}

export async function listChannelAccounts(token: string): Promise<ChannelAccountRow[]> {
  const data = await apiGet<{ accounts?: unknown[] }>(appRoutes.channelAccounts.list, token)
  const rows = Array.isArray(data.accounts) ? data.accounts : []
  return rows.map(normalizeAccount).filter((r): r is ChannelAccountRow => r !== null)
}
