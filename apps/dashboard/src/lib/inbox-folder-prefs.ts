/**
 * Default sub-view (Open / Mine / Unassigned / Closed) for channel and agent
 * folders in the Communication sidebar.
 *
 * Stored per user in `/me/preferences` under `inbox_folders`, so the choice
 * roams across devices:
 *
 * ```json
 * {
 *   "default_queue": "open",
 *   "channel_defaults": { "channel:email:12": "mine" }
 * }
 * ```
 *
 * `channel_defaults` keys are scope keys from {@link folderScopeKey} — a leaf
 * key without the queue segment.
 */

import { appRoutes } from '../api/routes'
import { APP_API_BASE } from './api.config'
import { isSubQueue, type HubLeaf, type SubQueue } from './messages-paths'

export type InboxFolderPrefs = {
  defaultQueue: SubQueue
  /** Per-folder override, keyed by folder scope key. */
  channelDefaults: Record<string, SubQueue>
}

export const DEFAULT_INBOX_FOLDER_PREFS: InboxFolderPrefs = {
  defaultQueue: 'open',
  channelDefaults: {},
}

/** Scope identity of a folder, ignoring the sub-queue. */
export function folderScopeKey(leaf: HubLeaf): string {
  switch (leaf.type) {
    case 'inbox':
      return 'inbox'
    case 'channel':
      return `channel:${leaf.channelKey}:${leaf.connectionId ?? ''}`
    case 'agent':
      return `agent:${leaf.agentId}`
    default:
      return leaf.type
  }
}

/** The sub-queue a folder opens on when clicked. */
export function resolveDefaultQueue(prefs: InboxFolderPrefs, leaf: HubLeaf): SubQueue {
  return prefs.channelDefaults[folderScopeKey(leaf)] ?? prefs.defaultQueue
}

export function parseInboxFolderPrefs(raw: unknown): InboxFolderPrefs {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_INBOX_FOLDER_PREFS, channelDefaults: {} }
  }
  const data = raw as {
    default_queue?: unknown
    channel_defaults?: unknown
  }
  const defaultQueue =
    typeof data.default_queue === 'string' && isSubQueue(data.default_queue) ? data.default_queue : 'open'
  const channelDefaults: Record<string, SubQueue> = {}
  if (data.channel_defaults && typeof data.channel_defaults === 'object') {
    for (const [key, value] of Object.entries(data.channel_defaults as Record<string, unknown>)) {
      if (typeof value === 'string' && isSubQueue(value)) channelDefaults[key] = value
    }
  }
  return { defaultQueue, channelDefaults }
}

export async function fetchInboxFolderPrefs(token: string): Promise<InboxFolderPrefs> {
  const res = await fetch(`${APP_API_BASE}${appRoutes.me.preferences}`, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { inbox_folders?: unknown }
  return parseInboxFolderPrefs(data.inbox_folders)
}

export async function saveInboxFolderPrefs(token: string, prefs: InboxFolderPrefs): Promise<void> {
  const res = await fetch(`${APP_API_BASE}${appRoutes.me.preferences}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({
      inbox_folders: {
        default_queue: prefs.defaultQueue,
        channel_defaults: prefs.channelDefaults,
      },
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}
