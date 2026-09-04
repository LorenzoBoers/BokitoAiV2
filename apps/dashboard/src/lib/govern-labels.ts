import type { TFunction } from 'i18next'
import { formatAppDateTime } from './app-locale'
import { humanizeLabel } from './labels'

export const RESOURCE_TYPE_LABELS: Record<string, string> = {
  agent: 'Agent',
  workstream: 'Flow',
  workspace_doc: 'Knowledge doc',
  integration: 'Integration',
  mcp_server: 'Connected tools',
  canvas_node: 'Canvas node',
  canvas_edge: 'Canvas connection',
  autonomy_posture: 'How much agents can do',
  persona_review: 'Voice review',
  case_type: 'Intake type',
  case_type_binding: 'Intake routing',
}

export const CHANGE_KIND_LABELS: Record<string, string> = {
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
  connect: 'Connect',
  review: 'Review',
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
  projects: { label: 'Projects', hint: 'Project docs, queue items, and repository work.' },
  agents: { label: 'Agents', hint: 'Creating and updating agents, flows, and tasks.' },
  delegation: { label: 'Delegation', hint: 'Handing work to an agent and scheduling tasks.' },
  channels: { label: 'Channels', hint: 'Channel accounts and routing.' },
  triggers: { label: 'Triggers', hint: 'Schedules, check-ins, and incoming triggers.' },
  integrations: { label: 'Integrations', hint: 'External connections and connected tools.' },
  govern: { label: 'Govern', hint: 'Policy and governance changes.' },
  cases: { label: 'Cases', hint: 'Opening and linking typed intake on a conversation.' },
}

const DIFF_FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  role: 'Role',
  system_prompt: 'Instructions',
  description: 'Description',
  enabled: 'Enabled',
  provider: 'Provider',
  display_name: 'Display name',
  server_url: 'Server URL',
  path: 'Doc path',
  content: 'Content',
  kind: 'Doc kind',
  agent_id: 'Agent',
  workstream_id: 'Flow',
  node_type: 'Node type',
  ref_id: 'Reference',
}

export function toolCategoryLabel(category: string, t: TFunction): string {
  const translated = t(`toolCategories.${category}.label`, { ns: 'govern', defaultValue: '' })
  if (translated) return translated
  return TOOL_CATEGORY_LABELS[category]?.label ?? humanizeLabel(category)
}

export function toolCategoryHint(category: string, t: TFunction): string {
  const translated = t(`toolCategories.${category}.hint`, { ns: 'govern', defaultValue: '' })
  if (translated) return translated
  return TOOL_CATEGORY_LABELS[category]?.hint ?? ''
}

export function allowanceModeLabel(mode: string, t: TFunction): string {
  const translated = t(`allowanceModes.${mode}.label`, { ns: 'govern', defaultValue: '' })
  if (translated) return translated
  return ALLOWANCE_MODE_LABELS[mode]?.label ?? humanizeLabel(mode)
}

export function allowanceModeHint(mode: string, t: TFunction): string {
  const translated = t(`allowanceModes.${mode}.hint`, { ns: 'govern', defaultValue: '' })
  if (translated) return translated
  return ALLOWANCE_MODE_LABELS[mode]?.hint ?? ''
}

export function governChangeStatusLabel(status: string, t: TFunction): string {
  return t(`changeMeta.status.${status}`, {
    ns: 'govern',
    defaultValue: status.replace(/_/g, ' '),
  })
}

export function formatChangeMeta(
  resourceType: string,
  changeKind: string,
  status: string,
  t?: TFunction,
): string {
  if (t) {
    const rt = t(`changeMeta.resourceType.${resourceType}`, {
      ns: 'govern',
      defaultValue: RESOURCE_TYPE_LABELS[resourceType] ?? resourceType,
    })
    const ck = t(`changeMeta.changeKind.${changeKind}`, {
      ns: 'govern',
      defaultValue: CHANGE_KIND_LABELS[changeKind] ?? changeKind,
    })
    const st = governChangeStatusLabel(status, t)
    return `${rt} · ${ck} · ${st}`
  }
  const rt = RESOURCE_TYPE_LABELS[resourceType] ?? resourceType
  const ck = CHANGE_KIND_LABELS[changeKind] ?? changeKind
  return `${rt} · ${ck} · ${status.replace(/_/g, ' ')}`
}

export function formatGovernTimestamp(value?: string | null, language?: string | null): string {
  if (!value) return '-'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : formatAppDateTime(d, language)
}

function diffFieldLabel(key: string, t?: TFunction): string {
  if (t) {
    return t(`diffFields.${key}`, {
      ns: 'govern',
      defaultValue: DIFF_FIELD_LABELS[key] ?? key.replace(/_/g, ' '),
    })
  }
  return DIFF_FIELD_LABELS[key] ?? key.replace(/_/g, ' ')
}

function formatDiffValue(value: unknown, t?: TFunction): string {
  if (value === null || value === undefined) {
    return t ? t('diff.emptyValue', { ns: 'govern', defaultValue: '(empty)' }) : '(empty)'
  }
  if (typeof value === 'boolean') {
    if (t) return value ? t('diff.yes', { ns: 'govern', defaultValue: 'yes' }) : t('diff.no', { ns: 'govern', defaultValue: 'no' })
    return value ? 'yes' : 'no'
  }
  if (typeof value === 'object') return JSON.stringify(value)
  const s = String(value)
  return s.length > 120 ? `${s.slice(0, 117)}...` : s
}

export function summarizeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  t?: TFunction,
): string[] {
  const lines: string[] = []
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const key of keys) {
    if (key === 'agent_id' || key === 'workstream_id') continue
    const b = before[key]
    const a = after[key]
    if (JSON.stringify(b) === JSON.stringify(a)) continue
    const label = diffFieldLabel(key, t)
    if (b === undefined || b === null || b === '') {
      lines.push(
        t
          ? t('diff.add', {
              ns: 'govern',
              label,
              value: formatDiffValue(a, t),
              defaultValue: `Add ${label}: ${formatDiffValue(a, t)}`,
            })
          : `Add ${label}: ${formatDiffValue(a, t)}`,
      )
    } else if (a === undefined || a === null || a === '') {
      lines.push(
        t
          ? t('diff.remove', { ns: 'govern', label, defaultValue: `Remove ${label}` })
          : `Remove ${label}`,
      )
    } else {
      lines.push(
        t
          ? t('diff.change', {
              ns: 'govern',
              label,
              before: formatDiffValue(b, t),
              after: formatDiffValue(a, t),
              defaultValue: `Change ${label}: ${formatDiffValue(b, t)} → ${formatDiffValue(a, t)}`,
            })
          : `Change ${label}: ${formatDiffValue(b, t)} → ${formatDiffValue(a, t)}`,
      )
    }
  }
  if (lines.length) return lines
  return [
    t
      ? t('diff.empty', { ns: 'govern', defaultValue: 'No field-level differences recorded.' })
      : 'No field-level differences recorded.',
  ]
}

export function statusTone(status: string): 'default' | 'active' | 'warning' | 'muted' {
  if (status === 'accepted' || status === 'applied_yolo') return 'active'
  if (status === 'pending_review' || status === 'draft') return 'warning'
  if (status === 'rejected' || status === 'superseded') return 'muted'
  return 'default'
}
