export const RESOURCE_TYPE_LABELS: Record<string, string> = {
  agent: 'Agent',
  workstream: 'Workstream',
  blueprint_block: 'Blueprint block',
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

export const APPLY_MODE_LABELS: Record<string, { label: string; hint: string }> = {
  draft: {
    label: 'Review queue',
    hint: 'Changes wait in Govern until a human accepts them.',
  },
  yolo: {
    label: 'Auto-apply',
    hint: 'Changes apply immediately without review.',
  },
  decision: {
    label: 'Decision required',
    hint: 'Each change opens a decision for approve or reject.',
  },
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
  page_slug: 'Blueprint page',
  text: 'Content',
  block_type: 'Block type',
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
