export type MailboxProvider = 'outlook' | 'gmail' | 'bokito';

export type MailboxStatus = 'connected' | 'syncing' | 'error' | 'token_expired' | 'needs_auth' | 'paused';

export interface MailboxConnection {
  id: number;
  /** ChannelAccount UUID backing this mailbox (agent bindings, visibility). */
  channel_account_id?: string | null;
  provider: MailboxProvider;
  email_address: string;
  display_name: string;
  status: MailboxStatus;
  last_sync_at: string | null;
  signature_html: string | null;
  sync_cursor: string | null;
  error_message?: string;
  /** When false, inbox sync skips this mailbox. */
  sync_enabled: boolean;
  /** Organisation primary mailbox (one active primary). */
  is_primary: boolean;
  /** Initial backfill window in days; 0 = no limit. */
  sync_window_days: number;
  created_at: string;
  updated_at: string;
}

export interface CreateMailboxConnectionRequest {
  provider: MailboxProvider;
  email_address: string;
  display_name: string;
}

export interface SyncStats {
  new_messages: number;
  last_sync_duration_ms: number;
}

export const MAILBOX_STATUS_LABELS: Record<MailboxStatus, string> = {
  connected: 'Connected',
  syncing: 'Syncing...',
  error: 'Error',
  token_expired: 'Token expired',
  needs_auth: 'Needs connection',
  paused: 'Paused',
};

export const MAILBOX_STATUS_VARIANTS: Record<MailboxStatus, 'success' | 'warning' | 'error' | 'neutral'> = {
  connected: 'success',
  syncing: 'warning',
  error: 'error',
  token_expired: 'warning',
  needs_auth: 'warning',
  paused: 'neutral',
};
