export const RESOURCE_TYPE_LABELS: Record<string, string> = {
  agent: 'Agent',
  workstream: 'Workstream',
  workspace_doc: 'Workspace doc',
  integration: 'Integration',
  mcp_server: 'MCP server',
  canvas_node: 'Canvas node',
  canvas_edge: 'Canvas connection',
}

export const CHANGE_KIND_LABELS: Record<string, string> = {
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
  connect: 'Connect',
}

export const ALLOWANCE_MODE_LABELS: Record<string, { label: string; hint: string }> = {
  deny: {
    label: 'Deny',
    hint: 'Agents cannot use these tools at all.',
  },
  ask: {
    label: 'Ask first',
    hint: 'Each action opens an inline decision for approve or reject.',
  },
  allow: {
    label: 'Allow',
    hint: 'Actions run automatically and are recorded in the audit log.',
  },
}

export const TOOL_CATEGORY_LABELS: Record<string, { label: string; hint: string }> = {
  messaging: { label: 'Messaging', hint: 'Replies, decisions, and thread actions.' },
  workspace: { label: 'Workspace', hint: 'Memory, docs, and skill edits, canvas nodes.' },
  agents: { label: 'Agents', hint: 'Creating and updating agents, workstreams, tasks.' },
  channels: { label: 'Channels', hint: 'Channel accounts and routing.' },
  triggers: { label: 'Triggers', hint: 'Schedules, heartbeats, and webhooks.' },
  integrations: { label: 'Integrations', hint: 'External connections and MCP servers.' },
  govern: { label: 'Govern', hint: 'Policy and governance changes.' },
}

export function formatChangeMeta(resourceType: string, changeKind: string, status: string): string {
  const rt = RESOURCE_TYPE_LABELS[resourceType] ?? resourceType
  const ck = CHANGE_KIND_LABELS[changeKind] ?? changeKind
  return `${rt} · ${ck} · ${status.replace(/_/g, ' ')}`
}

export function formatGovernTimestamp(value?: string | null): string {
  if (!value) return '-'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
}

const DIFF_FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  role: 'Role',
  system_prompt: 'System prompt',
  description: 'Description',
  enabled: 'Enabled',
  provider: 'Provider',
  display_name: 'Display name',
  server_url: 'Server URL',
  path: 'Doc path',
  content: 'Content',
  kind: 'Doc kind',
  agent_id: 'Agent',
  workstream_id: 'Workstream',
  node_type: 'Node type',
  ref_id: 'Reference',
}

export function summarizeDiff(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const lines: string[] = []
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const key of keys) {
    if (key === 'agent_id' || key === 'workstream_id') continue
    const b = before[key]
    const a = after[key]
    if (JSON.stringify(b) === JSON.stringify(a)) continue
    const label = DIFF_FIELD_LABELS[key] ?? key.replace(/_/g, ' ')
    if (b === undefined || b === null || b === '') {
      lines.push(`Add ${label}: ${formatDiffValue(a)}`)
    } else if (a === undefined || a === null || a === '') {
      lines.push(`Remove ${label}`)
    } else {
      lines.push(`Change ${label}: ${formatDiffValue(b)} → ${formatDiffValue(a)}`)
    }
  }
  return lines.length ? lines : ['No field-level differences recorded.']
}

function formatDiffValue(value: unknown): string {
  if (value === null || value === undefined) return '(empty)'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'object') return JSON.stringify(value)
  const s = String(value)
  return s.length > 120 ? `${s.slice(0, 117)}...` : s
}

export function statusTone(status: string): 'default' | 'active' | 'warning' | 'muted' {
  if (status === 'accepted' || status === 'applied_yolo') return 'active'
  if (status === 'pending_review' || status === 'draft') return 'warning'
  if (status === 'rejected' || status === 'superseded') return 'muted'
  return 'default'
}
