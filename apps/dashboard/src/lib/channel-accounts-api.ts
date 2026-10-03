/** Connected channel accounts (webchat, Slack, ...) for the Channels rail. */

import { appRoutes } from '../api/routes/app.routes'
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from './api'

export type ChannelAccessKind = 'user' | 'agent' | 'team'
export type ChannelAccessLevel = 'view' | 'handle'

/** One grant on a channel. System teams use their kind as id: `people` or `agents`. */
export type ChannelAccessEntry = {
  kind: ChannelAccessKind
  id: string
  level: ChannelAccessLevel
}

export type ChannelAccess = {
  entries: ChannelAccessEntry[]
  /** No explicit list: All people and All agents handle the channel. */
  isDefault: boolean
}

export type ChannelAccountRow = {
  id: string
  channel: string
  provider: string
  address: string
  displayName: string
  isEnabled: boolean
  defaultAgentId: string | null
  defaultTeamId: string | null
  access: ChannelAccess
}

export function normalizeAccess(rawEntries: unknown, rawDefault: unknown): ChannelAccess {
  const entries: ChannelAccessEntry[] = []
  if (Array.isArray(rawEntries)) {
    for (const item of rawEntries) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      const kind = row.kind
      const level = row.level === 'view' ? 'view' : 'handle'
      if ((kind === 'user' || kind === 'agent' || kind === 'team') && typeof row.id === 'string' && row.id) {
        entries.push({ kind, id: row.id, level })
      }
    }
  }
  return { entries, isDefault: rawDefault !== false }
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
    defaultAgentId: typeof raw.default_agent_id === 'string' ? raw.default_agent_id : null,
    defaultTeamId: typeof raw.default_team_id === 'string' ? raw.default_team_id : null,
    access: normalizeAccess(raw.access, raw.access_is_default),
  }
}

export async function updateChannelDefaultAgent(
  token: string,
  accountId: string,
  defaultAgentId: string | null,
): Promise<ChannelAccountRow | null> {
  const raw = await apiPatch<Record<string, unknown>>(
    appRoutes.channelAccounts.byId(accountId),
    { default_agent_id: defaultAgentId },
    token,
  )
  return normalizeAccount(raw)
}

export async function updateChannelDefaultTeam(
  token: string,
  accountId: string,
  defaultTeamId: string | null,
): Promise<void> {
  await apiPatch(appRoutes.channelAccounts.byId(accountId), { default_team_id: defaultTeamId }, token)
}

/** Replace who may view or handle a channel. `null` restores the default. */
export async function updateChannelAccess(
  token: string,
  accountId: string,
  entries: ChannelAccessEntry[] | null,
): Promise<ChannelAccess> {
  const raw = await apiPut<{ entries?: unknown; is_default?: unknown }>(
    appRoutes.channelAccounts.access(accountId),
    { entries },
    token,
  )
  return normalizeAccess(raw.entries, raw.is_default)
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

export async function createWhatsAppAccount(
  token: string,
  payload: {
    displayName: string
    phoneNumberId: string
    accessToken: string
    wabaId?: string
  },
): Promise<ChannelAccountRow> {
  const raw = await apiPost<Record<string, unknown>>(
    appRoutes.channelAccounts.list,
    {
      channel: 'whatsapp',
      provider: 'whatsapp_cloud',
      address: payload.phoneNumberId,
      display_name: payload.displayName,
      credentials: {
        access_token: payload.accessToken,
        waba_id: payload.wabaId ?? '',
      },
    },
    token,
  )
  const normalized = normalizeAccount(raw)
  if (!normalized) throw new Error('Unexpected response while connecting WhatsApp.')
  return normalized
}

export type WhatsAppSetupInfo = {
  webhookUrl: string
  verifyToken: string
  configured: boolean
}

export async function getWhatsAppSetup(token: string): Promise<WhatsAppSetupInfo> {
  const raw = await apiGet<Record<string, unknown>>(
    appRoutes.channelAccounts.whatsappSetup,
    token,
  )
  return {
    webhookUrl: typeof raw.webhook_url === 'string' ? raw.webhook_url : '',
    verifyToken: typeof raw.verify_token === 'string' ? raw.verify_token : '',
    configured: raw.configured === true,
  }
}

export type SmtpImapCredentials = {
  email: string
  username: string
  password: string
  imapHost: string
  imapPort: number
  imapSsl: boolean
  smtpHost: string
  smtpPort: number
  smtpSsl: boolean
  smtpStarttls: boolean
  displayName?: string
  /** Install backfill window in days (default 30). */
  syncWindowDays?: number
}

export async function createSmtpImapAccount(
  token: string,
  payload: SmtpImapCredentials,
): Promise<ChannelAccountRow> {
  const raw = await apiPost<Record<string, unknown>>(
    appRoutes.channelAccounts.list,
    {
      channel: 'email',
      provider: 'smtp_imap',
      address: payload.email,
      display_name: payload.displayName?.trim() || payload.email,
      sync_window_days: payload.syncWindowDays ?? 30,
      credentials: {
        email: payload.email,
        username: payload.username,
        password: payload.password,
        imap_host: payload.imapHost,
        imap_port: payload.imapPort,
        imap_ssl: payload.imapSsl,
        smtp_host: payload.smtpHost,
        smtp_port: payload.smtpPort,
        smtp_ssl: payload.smtpSsl,
        smtp_starttls: payload.smtpStarttls,
      },
    },
    token,
  )
  const normalized = normalizeAccount(raw)
  if (!normalized) throw new Error('Unexpected response while connecting SMTP/IMAP.')
  return normalized
}

export async function verifySmtpImapAccount(
  token: string,
  accountId: string,
): Promise<ChannelAccountRow> {
  const raw = await apiPost<Record<string, unknown>>(
    appRoutes.channelAccounts.verify(accountId),
    {},
    token,
  )
  const normalized = normalizeAccount(raw)
  if (!normalized) throw new Error('Unexpected response while verifying SMTP/IMAP.')
  return normalized
}

export async function deleteChannelAccount(token: string, accountId: string): Promise<void> {
  await apiDelete(appRoutes.channelAccounts.byId(accountId), token)
}
