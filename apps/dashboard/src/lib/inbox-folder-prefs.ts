/**
 * Default sub-view (Open / Mine / Unassigned / Closed) for channel and tag
 * folders in the Communication sidebar, plus which tags stay pinned there.
 *
 * Stored per user in `/me/preferences` under `inbox_folders`, so the choice
 * roams across devices:
 *
 * ```json
 * {
 *   "default_queue": "open",
 *   "channel_defaults": { "channel:email:12": "mine" },
 *   "sidebar_tags": ["billing", "vip"]
 * }
 * ```
 *
 * `channel_defaults` keys are scope keys from {@link folderScopeKey} — a leaf
 * key without the queue segment.
 * `sidebar_tags` are tag names pinned as default folders in the Tags section.
 */

import { appRoutes } from '../api/routes'
import { APP_API_BASE } from './api.config'
import { isSubQueue, type HubLeaf, type SubQueue } from './messages-paths'

export type InboxFolderPrefs = {
  defaultQueue: SubQueue
  /** Per-channel/tag override, keyed by folder scope key. */
  channelDefaults: Record<string, SubQueue>
  /** Tags always shown in the Communication sidebar (default views). */
  sidebarTags: string[]
}

export const DEFAULT_INBOX_FOLDER_PREFS: InboxFolderPrefs = {
  defaultQueue: 'open',
  channelDefaults: {},
  sidebarTags: [],
}

const MAX_SIDEBAR_TAGS = 40
const MAX_TAG_LEN = 40

/** Normalize a tag name the same way thread tagging does (trim + lower). */
export function normalizeSidebarTag(raw: string): string {
  return raw.trim().toLowerCase().slice(0, MAX_TAG_LEN)
}

export function cleanSidebarTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const tag = normalizeSidebarTag(item)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
    if (out.length >= MAX_SIDEBAR_TAGS) break
  }
  return out
}

/** Scope identity of a folder (channel, tag, or agent), ignoring the sub-queue. */
export function folderScopeKey(leaf: HubLeaf): string {
  switch (leaf.type) {
    case 'inbox':
      return 'inbox'
    case 'channel':
      return `channel:${leaf.channelKey}:${leaf.connectionId ?? ''}`
    case 'tag':
      return `tag:${leaf.tag}`
    case 'agent':
      return `agent:${leaf.agentId}`
    case 'assistant':
      return 'assistant'
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
    return { ...DEFAULT_INBOX_FOLDER_PREFS, channelDefaults: {}, sidebarTags: [] }
  }
  const data = raw as {
    default_queue?: unknown
    channel_defaults?: unknown
    sidebar_tags?: unknown
  }
  const defaultQueue =
    typeof data.default_queue === 'string' && isSubQueue(data.default_queue) ? data.default_queue : 'open'
  const channelDefaults: Record<string, SubQueue> = {}
  if (data.channel_defaults && typeof data.channel_defaults === 'object') {
    for (const [key, value] of Object.entries(data.channel_defaults as Record<string, unknown>)) {
      if (typeof value === 'string' && isSubQueue(value)) channelDefaults[key] = value
    }
  }
  return { defaultQueue, channelDefaults, sidebarTags: cleanSidebarTags(data.sidebar_tags) }
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
        sidebar_tags: prefs.sidebarTags,
      },
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}
