export type MailboxProvider = 'outlook' | 'gmail';

export type MailboxStatus = 'connected' | 'syncing' | 'error' | 'token_expired';

export interface MailboxConnection {
  id: number;
  workspace_id: number;
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
  created_at: string;
  updated_at: string;
}

export type RoutingConditionType = 'sender_domain' | 'subject_contains' | 'mailbox';

export interface RoutingRule {
  id: number;
  mailbox_connection_id: number;
  condition_type: RoutingConditionType;
  condition_value: string;
  assign_to_user_id: number | null;
  labels: string[];
  priority: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateMailboxConnectionRequest {
  provider: MailboxProvider;
  email_address: string;
  display_name: string;
}

export interface CreateRoutingRuleRequest {
  mailbox_connection_id: number;
  condition_type: RoutingConditionType;
  condition_value: string;
  assign_to_user_id?: number;
  labels?: string[];
  priority?: number;
  active?: boolean;
}

export interface UpdateRoutingRuleRequest {
  condition_type?: RoutingConditionType;
  condition_value?: string;
  assign_to_user_id?: number;
  labels?: string[];
  priority?: number;
  active?: boolean;
}

export interface SyncStats {
  new_messages: number;
  last_sync_duration_ms: number;
}

export const MAILBOX_STATUS_LABELS: Record<MailboxStatus, string> = {
  connected: 'Verbonden',
  syncing: 'Synchroniseren...',
  error: 'Fout',
  token_expired: 'Token verlopen'
};

export const MAILBOX_STATUS_VARIANTS: Record<MailboxStatus, 'success' | 'warning' | 'error' | 'neutral'> = {
  connected: 'success',
  syncing: 'warning',
  error: 'error',
  token_expired: 'warning'
};

export const ROUTING_CONDITION_LABELS: Record<RoutingConditionType, string> = {
  sender_domain: 'Afzender domein',
  subject_contains: 'Onderwerp bevat',
  mailbox: 'Mailbox'
};