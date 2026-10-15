/**
 * Public docs / API-reference chat widget config.
 *
 * Docs sit outside the logged-in shell, so the launcher must be the Bokito
 * tenant's anonymous website-chat channel — same contract as a customer site
 * embed (`data-auth-mode="anonymous"` + `data-channel-id`).
 *
 * Override with Vite env when a new environment gets its own channel row:
 *   VITE_DOCS_CHAT_TENANT, VITE_DOCS_CHAT_CHANNEL_ID, VITE_DOCS_CHAT_AGENT_SLUG
 */
import { DASHBOARD_CHAT_AGENT_SLUG } from './api.config'

/** Production Bokito Website chat (`Settings → Channels → Website chat`). */
const PROD_BOKITO_WIDGET_CHANNEL_ID = 'f3918cfc-d01c-439b-9e3a-a589c504fb24'

/** bokito-dev Bokito Website chat (same tenant slug, separate DB). */
const DEV_BOKITO_WIDGET_CHANNEL_ID = '54db2b77-c50d-4c1b-83a9-689bdaca01ed'

function hostDefaultChannelId(): string {
  if (typeof window === 'undefined') return PROD_BOKITO_WIDGET_CHANNEL_ID
  const host = window.location.hostname
  if (host === 'dev.app.bokito.ai' || host.endsWith('.dev.app.bokito.ai')) {
    return DEV_BOKITO_WIDGET_CHANNEL_ID
  }
  return PROD_BOKITO_WIDGET_CHANNEL_ID
}

export type DocsPublicChatConfig = {
  tenant: string
  channelId: string
  agentSlug: string
}

/** Resolved embed attributes for the public docs launcher. */
export function docsPublicChatConfig(): DocsPublicChatConfig {
  const tenant = (import.meta.env.VITE_DOCS_CHAT_TENANT || 'bokito').trim() || 'bokito'
  const channelId =
    (import.meta.env.VITE_DOCS_CHAT_CHANNEL_ID || '').trim() || hostDefaultChannelId()
  const agentSlug =
    (import.meta.env.VITE_DOCS_CHAT_AGENT_SLUG || DASHBOARD_CHAT_AGENT_SLUG || 'assistant').trim() ||
    'assistant'
  return { tenant, channelId, agentSlug }
}
