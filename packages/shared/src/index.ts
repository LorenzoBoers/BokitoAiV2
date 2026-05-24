export type AgentRole =
  | 'po'
  | 'coding'
  | 'testing'
  | 'documentation'
  | 'research'
  | 'copywriter'
  | 'seo'

export type MessageChannel =
  | 'internal'
  | 'email'
  | 'livechat'
  | 'mobile_push'
  | 'sms'
  | 'whatsapp'
  | 'system'

export type MessageType =
  | 'task_request'
  | 'task_result'
  | 'status_update'
  | 'pkb_change'
  | 'decision_request'
  | 'token_warning'
  | 'token_limit_reached'
  | 'integration_required'
  | 'email_inbound'
  | 'email_outbound'
  | 'chat'
  | 'note'
  | 'agent_invocation'

export type MessageStatus =
  | 'pending'
  | 'processing'
  | 'awaiting_human'
  | 'done'
  | 'failed'

export type PkbLayer = 'current_state' | 'intended_state' | 'change_queue'
export type PkbDomain =
  | 'code'
  | 'marketing'
  | 'research'
  | 'design'
  | 'operations'
  | 'other'

export interface MessageRow {
  id: string
  tenant_id: string
  project_id: string | null
  thread_id: string
  parent_message_id: string | null
  from_type: 'agent' | 'user' | 'customer' | 'system'
  from_id: string
  to_type: 'agent' | 'user' | 'team' | 'customer' | 'broadcast' | null
  to_id: string | null
  channel: MessageChannel
  message_type: MessageType
  subject: string | null
  body: string
  body_html: string | null
  payload: Record<string, unknown>
  external_id: string | null
  status: MessageStatus
  created_at: string
  resolved_at: string | null
}

export interface WorkLogEvent {
  type: 'tool_call' | 'read' | 'think' | 'log' | 'error'
  title?: string
  body?: string
  payload?: Record<string, unknown>
  at?: string
}

export interface RunConfigAgent {
  id: string
  name: string
  role: AgentRole
  model: string
  system_prompt: string
  max_loops: number
  tools: Array<{ tool_id: string; config: Record<string, unknown> }>
}

export interface RunConfigJson {
  run_id: string
  project_id: string
  tenant_id: string
  work_log_id: string
  project: {
    name: string
    autonomous_scope: string
  }
  agent: RunConfigAgent
  task: {
    thread_id: string
    trigger_message_id: string
    subject: string
    body: string
    payload: Record<string, unknown>
    change_queue_section_id?: string | null
  }
  report_to: { type: 'agent' | 'user' | 'team'; id: string }
  budget: { remaining_today: number; remaining_hour: number }
  xano: {
    base_url: string
    work_log_url: string
    messages_url: string
    search_index_url: string
    /** @deprecated Replaced by doc_* endpoints. Kept for legacy agent loop compat. */
    pkb_url?: string
    /** @deprecated */
    pkb_list_url?: string
    /** @deprecated */
    pkb_update_url?: string
    /** Worker batch endpoint: agents POST block ops here with change notes. */
    doc_blocks_worker_url: string
    /** Worker reindex endpoint for a single page. */
    doc_reindex_page_url: string
    /** Doc map (compact list of pages + headings) injected into agent prompts. */
    doc_map?: string
  }
}
