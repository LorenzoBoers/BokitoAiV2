export const CUSTOMER_VIEWS = [
  'all_open',
  'mine',
  'unassigned',
  'awaiting_decision',
  'pinned',
  'snoozed',
  'closed',
  'spam',
] as const

export const TEAM_VIEWS = ['all_open', 'updates', 'results', 'awaiting_decision', 'closed'] as const

export const ALL_FOLDER_VIEWS = [
  'all_open',
  'mine',
  'unassigned',
  'awaiting_decision',
  'updates',
  'results',
  'pinned',
  'snoozed',
  'closed',
  'spam',
] as const

export type InboxViewId = (typeof ALL_FOLDER_VIEWS)[number]
export type InboxFolder = '' | 'external' | 'internal'

export function viewsForFolder(folder: string): readonly InboxViewId[] {
  if (folder === 'internal') return TEAM_VIEWS
  if (folder === 'external') return CUSTOMER_VIEWS
  return ALL_FOLDER_VIEWS
}

export function coerceInboxView(folder: string, view: string): InboxViewId {
  const views = viewsForFolder(folder)
  return views.includes(view as InboxViewId) ? (view as InboxViewId) : 'all_open'
}

export function inboxFolderParam(view: InboxViewId, folder: string): string | undefined {
  if (view === 'awaiting_decision') return undefined
  return folder || undefined
}

export function tomorrowMorningIso(now = new Date()): string {
  const next = new Date(now)
  next.setDate(next.getDate() + 1)
  next.setHours(9, 0, 0, 0)
  return next.toISOString()
}
