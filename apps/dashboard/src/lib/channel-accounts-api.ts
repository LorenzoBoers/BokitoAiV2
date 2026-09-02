/** Connected channel accounts (webchat, Slack, ...) for the Channels rail. */

import { appRoutes } from '../api/routes/app.routes'
import { apiDelete, apiGet, apiPatch, apiPost } from './api'

export type ChannelVisibilityMode = 'everyone' | 'selected'

export type ChannelAccountVisibility = {
  mode: ChannelVisibilityMode
  userIds: string[]
}

export type ChannelAccountRow = {
  id: string
  channel: string
  provider: string
  address: string
  displayName: string
  isEnabled: boolean
  visibility: ChannelAccountVisibility
}

export function normalizeVisibility(raw: unknown): ChannelAccountVisibility {
  if (raw && typeof raw === 'object') {
    const value = raw as Record<string, unknown>
    const mode = value.mode === 'selected' ? 'selected' : 'everyone'
    const userIds = Array.isArray(value.user_ids)
      ? value.user_ids.filter((u): u is string => typeof u === 'string')
      : []
    return { mode, userIds }
  }
  return { mode: 'everyone', userIds: [] }
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
    visibility: normalizeVisibility(raw.visibility),
  }
}

export async function updateChannelAccountVisibility(
  token: string,
  accountId: string,
  mode: ChannelVisibilityMode,
  userIds: string[],
): Promise<ChannelAccountRow | null> {
  const raw = await apiPatch<Record<string, unknown>>(
    appRoutes.channelAccounts.visibility(accountId),
    { mode, user_ids: mode === 'selected' ? userIds : [] },
    token,
  )
  return normalizeAccount(raw)
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
