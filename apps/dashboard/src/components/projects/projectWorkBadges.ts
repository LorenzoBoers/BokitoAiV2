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
  'accepted',
  'analyzing',
  'planned',
  'in_progress',
  'verifying',
  'done',
  'rejected',
]

/** Legal moves per status; mirrors QUEUE_TRANSITIONS in the API. */
export const QUEUE_TRANSITIONS: Record<QueueItemStatus, QueueItemStatus[]> = {
  proposed: ['accepted', 'rejected'],
  accepted: ['analyzing', 'planned', 'rejected'],
  analyzing: ['planned', 'accepted', 'rejected'],
  planned: ['in_progress', 'analyzing', 'rejected'],
  in_progress: ['verifying', 'planned', 'rejected'],
  verifying: ['done', 'in_progress'],
  done: [],
  rejected: ['proposed'],
}

export const QUEUE_STATUS_VARIANT: Record<QueueItemStatus, BadgeVariant> = {
  proposed: 'warning',
  accepted: 'info',
  analyzing: 'accent',
  planned: 'info',
  in_progress: 'accent',
  verifying: 'warning',
  done: 'success',
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
