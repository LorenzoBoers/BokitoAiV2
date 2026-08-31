// Shared badge styling for the project work surface (queue + smart docs).
import type { DocSectionStatus, QueueItemKind, QueueItemStatus } from '../../lib/project-work-api'

type BadgeVariant =
  | 'neutral'
  | 'default'
  | 'outline'
  | 'secondary'
  | 'accent'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'

export const QUEUE_STATUS_ORDER: QueueItemStatus[] = [
  'proposed',
  'queued',
  'analyzing',
  'planned',
  'running',
  'verifying',
  'completed',
  'rejected',
]

/** Legal moves per status; mirrors QUEUE_TRANSITIONS in the API. */
export const QUEUE_TRANSITIONS: Record<QueueItemStatus, QueueItemStatus[]> = {
  proposed: ['queued', 'rejected'],
  queued: ['analyzing', 'planned', 'rejected'],
  analyzing: ['planned', 'queued', 'rejected'],
  planned: ['running', 'analyzing', 'rejected'],
  running: ['verifying', 'planned', 'completed', 'rejected'],
  verifying: ['completed', 'running'],
  completed: [],
  rejected: ['proposed'],
}

export const QUEUE_STATUS_VARIANT: Record<QueueItemStatus, BadgeVariant> = {
  proposed: 'warning',
  queued: 'info',
  analyzing: 'accent',
  planned: 'info',
  running: 'accent',
  verifying: 'warning',
  completed: 'success',
  rejected: 'neutral',
}

export const QUEUE_KIND_VARIANT: Record<QueueItemKind, BadgeVariant> = {
  feature: 'accent',
  bug: 'error',
  task: 'neutral',
  idea: 'info',
  risk: 'warning',
}

export const SECTION_STATUS_VARIANT: Record<DocSectionStatus, BadgeVariant> = {
  open: 'warning',
  planned: 'info',
  in_progress: 'accent',
  implemented: 'success',
  verified: 'success',
  deprecated: 'neutral',
}

/** Left rail color per section status (design tokens, no emoji). */
export const SECTION_STATUS_RAIL: Record<DocSectionStatus, string> = {
  open: 'bg-status-warning',
  planned: 'bg-status-info',
  in_progress: 'bg-accent',
  implemented: 'bg-status-success',
  verified: 'bg-status-success',
  deprecated: 'bg-border',
}
