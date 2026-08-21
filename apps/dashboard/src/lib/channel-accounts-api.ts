/** Connected channel accounts (webchat, Slack, ...) for the Channels rail. */

import { appRoutes } from '../api/routes/app.routes'
import { apiDelete, apiGet, apiPost } from './api'

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

export async function createSlackAccount(
  token: string,
  payload: {
    workspaceName: string
    botToken: string
    signingSecret: string
    notifyChannelId?: string
  },
): Promise<ChannelAccountRow & { inboundSecret?: string }> {
  const raw = await apiPost<Record<string, unknown>>(
    appRoutes.channelAccounts.list,
    {
      channel: 'slack',
      provider: 'slack',
      display_name: payload.workspaceName,
      credentials: {
        bot_token: payload.botToken,
        signing_secret: payload.signingSecret,
      },
      notify_channel_id: payload.notifyChannelId ?? '',
    },
    token,
  )
  const normalized = normalizeAccount(raw)
  if (!normalized) throw new Error('Unexpected response while connecting Slack.')
  return {
    ...normalized,
    inboundSecret: typeof raw.inbound_secret === 'string' ? raw.inbound_secret : undefined,
  }
}

export async function deleteChannelAccount(token: string, accountId: string): Promise<void> {
  await apiDelete(appRoutes.channelAccounts.byId(accountId), token)
}
