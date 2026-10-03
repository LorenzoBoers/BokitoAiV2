import type { AiHandling } from '../../lib/ai-handling'
import type { ChannelRow } from '../../lib/channels-api'

/** Everything an operator can do to a channel; the settings page owns the API calls. */
export type ChannelActions = {
  setPaused: (row: ChannelRow, paused: boolean) => void
  sync: (row: ChannelRow) => void
  reconnect: (row: ChannelRow) => void
  makePrimary: (row: ChannelRow) => void
  rename: (row: ChannelRow) => void
  remove: (row: ChannelRow) => void
  setSyncWindow: (row: ChannelRow, days: number) => void
  editFolders: (row: ChannelRow) => void
  editSignature: (row: ChannelRow) => void
  aiHandlingChanged: (row: ChannelRow, next: AiHandling | null) => void
  accessChanged: (row: ChannelRow) => void
}

/** The single repair a row offers when it is not healthy, or null. */
export type ChannelFix = 'reconnect' | 'retry_sync' | 'resume'

export function channelFix(row: ChannelRow): ChannelFix | null {
  if (!row.isEnabled) return 'resume'
  if (row.actions.includes('reconnect') && row.state === 'action_required') return 'reconnect'
  const canSync = row.capabilities.includes('sync')
  if (
    canSync &&
    (row.actions.includes('retry_sync') ||
      row.state === 'error' ||
      row.state === 'degraded' ||
      (row.state === 'connecting' && Boolean(row.lastError)))
  ) {
    return 'retry_sync'
  }
  return null
}
