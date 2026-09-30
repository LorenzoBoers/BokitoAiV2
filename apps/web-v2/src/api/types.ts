/** Response shapes of api-v2 (mirrors `bokito/api/schemas.py`). */

export type Posture = 'manual' | 'assisted' | 'autonomous'
export type Channel = 'email' | 'whatsapp' | 'widget' | 'phone' | 'slack' | 'internal' | 'api'
export type ConversationStatus = 'open' | 'waiting' | 'snoozed' | 'closed'
export type Queue = 'attention' | 'mine' | 'agents' | 'waiting' | 'all'

export type Conversation = {
  id: string
  channel: Channel
  external_id: string | null
  status: ConversationStatus
  subject: string
  connection_id: string | null
  contact_id: string | null
  agent_id: string | null
  assignee_user_id: string | null
  signal_type_id: string | null
  tags: string[]
  participants: Array<{ contact_id?: string; name?: string }>
  priority: number
  unread: boolean
  handoff: boolean
  follow_up_at: string | null
  last_activity_at: string
  last_inbound_at: string | null
  closed_at: string | null
  compact_summary: string
  created_at: string
}

export type ConversationList = {
  items: Conversation[]
  next_cursor: string | null
  counts: Record<string, number>
}

export type MessageKind = 'message' | 'note' | 'decision' | 'action' | 'run' | 'system'
export type Direction = 'inbound' | 'outbound' | 'internal'

export type Message = {
  id: string
  conversation_id: string
  kind: MessageKind
  direction: Direction
  author_user_id: string | null
  author_agent_id: string | null
  author_contact_id: string | null
  author_label: string
  body: string
  html: string | null
  attachments: Array<{ name?: string; url?: string; type?: string }>
  send_status: 'none' | 'draft' | 'queued' | 'sent' | 'delivered' | 'failed'
  send_error: string
  ai_generated: boolean
  run_id: string | null
  external_id: string | null
  meta: Record<string, unknown>
  created_at: string
  sent_at: string | null
}

export type DecisionOption = { id: string; label: string; kind?: string }

export type Decision = {
  id: string
  conversation_id: string
  message_id: string | null
  run_id: string | null
  status: 'open' | 'approved' | 'rejected' | 'expired'
  title: string
  summary: string
  options: DecisionOption[]
  tool_call: { name?: string; args?: Record<string, unknown> } | null
  requested_by: string
  chosen_option: string | null
  resolution_note: string
  resolved_by_user_id: string | null
  result: Record<string, unknown> | null
  expires_at: string | null
  created_at: string
  resolved_at: string | null
}

export type Signal = {
  id: string
  conversation_id: string
  type_id: string
  status: 'open' | 'waiting' | 'done'
  title: string
  fields: Record<string, unknown>
  confidence: number
  source: string
  created_at: string
  done_at: string | null
}

export type SignalType = {
  id: string
  slug: string
  name: string
  description: string
  color: string
  fields: unknown[]
  recognition: Record<string, unknown>
  autonomy_cap: Posture | null
  playbook_id: string | null
  module: string
  enabled: boolean
}

export type Thread = {
  items: Message[]
  decisions: Decision[]
  signals: Signal[]
  next_before: string | null
}

export type Contact = {
  id: string
  name: string
  email: string | null
  phone: string | null
  organization_id: string | null
  language: string
  kind: string
  handles: Record<string, string>
  fields: Record<string, unknown>
  verified: boolean
  memory: string
  last_seen_at: string | null
  created_at: string
}

export type Organization = {
  id: string
  name: string
  domain: string | null
  kind: string
  fields: Record<string, unknown>
  notes: string
  created_at: string
}

export type Agent = {
  id: string
  slug: string
  name: string
  role: string
  instructions: string
  model: string
  tools: string[]
  autonomy_cap: Posture | null
  scopes: Record<string, unknown>
  channels: string[]
  language: string
  active: boolean
  is_default: boolean
  persona_doc_id: string | null
  created_at: string
  updated_at: string
}

export type PlaybookStep = { title: string; instruction?: string }

export type Playbook = {
  id: string
  slug: string
  name: string
  description: string
  steps: PlaybookStep[]
  agent_id: string | null
  autonomy_cap: Posture | null
  module: string
  active: boolean
  created_at: string
}

export type RunStatus = 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'cancelled'

export type Run = {
  id: string
  kind: 'reply' | 'playbook' | 'trigger' | 'tool' | 'job'
  status: RunStatus
  title: string
  actor: string
  trust: string
  conversation_id: string | null
  agent_id: string | null
  playbook_id: string | null
  trigger_id: string | null
  parent_run_id: string | null
  tool_name: string
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  error: string
  step: number
  cost_eur: number
  tokens_in: number
  tokens_out: number
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export type RunEvent = {
  id: string
  seq: number
  kind: string
  payload: Record<string, unknown>
  created_at: string
}

export type RunDetail = Run & { events: RunEvent[] }

export type Trigger = {
  id: string
  name: string
  kind: 'cron' | 'interval' | 'webhook' | 'event'
  spec: Record<string, unknown>
  agent_id: string | null
  playbook_id: string | null
  instructions: string
  active: boolean
  last_fired_at: string | null
  next_fire_at: string | null
}

export type ConnectionKind =
  | 'email'
  | 'whatsapp'
  | 'widget'
  | 'phone'
  | 'slack'
  | 'mcp'
  | 'integration'
  | 'workbench'
  | 'model_provider'

export type Connection = {
  id: string
  kind: ConnectionKind
  provider: string
  name: string
  status: 'pending' | 'active' | 'error' | 'disabled'
  status_message: string
  address: string
  settings: Record<string, unknown>
  capabilities: string[]
  disclosure_enabled: boolean
  region: string
  agent_id: string | null
  public_key: string
  last_used_at: string | null
  verified_at: string | null
  created_at: string
  credentials_masked: Record<string, string>
}

export type Provider = {
  provider: string
  name: string
  fields: string[]
  description?: string
  region?: string
  module?: string
}

export type ModuleSetting = { type: string; default?: unknown; label?: string }

export type Module = {
  slug: string
  name: string
  description: string
  version: string
  connection_provider: string | null
  connection_kind: string
  signal_types: string[]
  playbooks: string[]
  docs: string[]
  tools: string[]
  settings_schema: Record<string, ModuleSetting>
  installed: boolean
  install: {
    id: string
    version: string
    settings: Record<string, unknown>
    connection_id: string | null
    enabled: boolean
    installed_at: string
    updated_at: string
  } | null
  created?: { signal_types: number; playbooks: number; docs: number }
}

export type DocKind = 'doc' | 'memory' | 'persona' | 'skill' | 'snippet'

export type DocSummary = {
  id: string
  kind: DocKind
  path: string
  title: string
  published: boolean
  ai_maintained: boolean
  updated_at: string
}

export type Doc = DocSummary & {
  body: string
  frontmatter: Record<string, unknown>
  source: string
  indexed_at: string | null
  created_at: string
}

export type KnowledgeHit = {
  doc_id: string
  title: string
  path: string
  kind: string
  heading: string
  text: string
  score: number
}

export type Verdict = 'allow' | 'ask' | 'deny'
export type ToolCategory = 'read' | 'write' | 'communicate' | 'external' | 'destructive'

export type Policy = {
  id: string
  posture: Posture
  allowances: Partial<Record<ToolCategory, Verdict>>
  tool_overrides: Record<string, Verdict>
  consequential: string[]
  budgets: Record<string, unknown>
  disclosure_text: string
}

export type Change = {
  id: string
  status: 'draft' | 'applied' | 'rejected' | 'rolled_back'
  target_kind: string
  target_id: string | null
  title: string
  before: Record<string, unknown> | null
  after: Record<string, unknown>
  proposed_by: string
  conversation_id: string | null
  decision_id: string | null
  created_at: string
  applied_at: string | null
  rolled_back_at: string | null
}

export type AuditEvent = {
  id: string
  actor: string
  trust: string
  action: string
  target_kind: string
  target_id: string
  conversation_id: string | null
  run_id: string | null
  payload: Record<string, unknown>
  created_at: string
}

export type ApiToken = {
  id: string
  name: string
  prefix: string
  scopes: string[]
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
  token?: string
}

export type UsageLine = {
  kind: string
  provider: string
  model?: string
  region: string
  billed_by_tenant?: boolean
  events: number
  tokens_in: number
  tokens_out: number
  cost_eur: number
}

export type UsageReport = {
  since: string
  until: string
  lines: UsageLine[]
  by_day: Array<{ day: string; cost_eur: number }>
  total_cost_eur: number
  eu_share: number
}

export type ConversationUsage = {
  conversation_id: string
  lines: UsageLine[]
  total_cost_eur: number
}

export type OutcomeSummary = {
  since: string
  conversations: number
  resolved_by_agent: number
  resolution_rate: number
  handoffs: number
  time_saved_hours: number
  cost_eur: number
  median_first_response_seconds: number | null
}

export type ToolOutcome = {
  status: 'done' | 'decision' | 'denied'
  run_id: string
  result: unknown
  decision_id: string | null
  reason: string
}

export type ToolDef = {
  name: string
  description: string
  category: ToolCategory
  consequential: boolean
  module: string
  input_schema: {
    properties?: Record<string, { type?: string; title?: string; description?: string; default?: unknown }>
    required?: string[]
  }
}

export type Workspace = {
  id: string
  slug: string
  name: string
  posture: Posture
  region: string
  language: string
  settings: Record<string, unknown>
}

export type Member = { user_id: string; email: string; name: string; role: string; joined_at: string }

export type Invite = {
  id: string
  email: string
  role: string
  expires_at: string
  accepted_at: string | null
  created_at: string
  accept_url: string | null
}

export type Feedback = {
  id: string
  conversation_id: string | null
  message_id: string | null
  run_id: string | null
  verdict: 'good' | 'bad' | 'corrected'
  comment: string
  correction: string
  created_at: string
}
