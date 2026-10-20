import type { ReactNode } from 'react'
import type { NavRow } from './signals-api'

/** Prefs slice that orders and hides rows inside a sidebar section. */
export type SidebarLayoutPrefs = {
  itemOrder: Record<string, string[]>
  hiddenItems: string[]
}

export const INBOX_PARENT = 'inbox'
export const FOLDER_TAGS_PARENT = 'folders:tags'
export const INBOX_SIDEBAR_QUEUES = ['for_you', 'open', 'unassigned', 'scheduled', 'spam'] as const
export type InboxSidebarQueue = (typeof INBOX_SIDEBAR_QUEUES)[number]

export function queueItemId(queue: string): string {
  return `queue:${queue}`
}

export function folderItemId(id: string): string {
  return `folder:${id}`
}

export function flowItemId(id: string): string {
  return `flow:${id}`
}

export function tagItemId(id: string): string {
  return `tag:${id}`
}

export function channelItemId(channelKey: string, connectionId?: string): string {
  return `channel:${channelKey}:${connectionId ?? ''}`
}

export function agentItemId(id: string): string {
  return `agent:${id}`
}

export function teamItemId(id: string): string {
  return `team:${id}`
}

/** Saved order first, then any new ids at the end. Unknown saved ids drop out. */
export function orderIds(saved: readonly string[] | undefined, available: readonly string[]): string[] {
  const known = new Set(available)
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of saved ?? []) {
    if (!known.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  for (const id of available) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** Voor jou and Alles cannot both be hidden. */
export function canHideItem(id: string, hiddenItems: readonly string[]): boolean {
  if (id !== 'queue:for_you' && id !== 'queue:open') return true
  const other = id === 'queue:for_you' ? 'queue:open' : 'queue:for_you'
  return !hiddenItems.includes(other)
}

export function applyOrder<T>(
  items: readonly T[],
  parentId: string,
  idOf: (item: T) => string,
  prefs: SidebarLayoutPrefs,
  includeHidden = false,
): T[] {
  const order = orderIds(prefs.itemOrder[parentId], items.map(idOf))
  const byId = new Map(items.map((item) => [idOf(item), item]))
  const hidden = new Set(prefs.hiddenItems)
  const out: T[] = []
  for (const id of order) {
    if (!includeHidden && hidden.has(id)) continue
    const item = byId.get(id)
    if (item) out.push(item)
  }
  return out
}

export function applyTreeOrder<T extends { children?: T[] }>(
  rows: readonly T[],
  parentId: string,
  idOf: (row: T) => string,
  prefs: SidebarLayoutPrefs,
  includeHidden = false,
): T[] {
  return applyOrder(rows, parentId, idOf, prefs, includeHidden).map((row) => {
    const children = row.children
    if (!children?.length) return row
    return {
      ...row,
      children: applyTreeOrder(children, idOf(row), idOf, prefs, includeHidden),
    }
  })
}

export type CatalogNode = {
  id: string
  parentId: string
  label: string
  children: CatalogNode[]
  href?: string
  /** Stays put. Alle communicatie, Contacten, Instellingen. */
  fixed?: boolean
  hideKind: 'section' | 'item' | 'none'
  hidden?: boolean
  /** Same mark the rail draws in front of the label. */
  icon?: ReactNode
  /** Replaces the text label when the rail shows a pill instead. */
  mark?: ReactNode
}

export type CatalogLabels = {
  inbox: string
  folders: string
  flows: string
  channels: string
  agents: string
  teams: string
  contacts: string
  settings: string
  queues: Record<InboxSidebarQueue, string>
}

export type CatalogSection = 'folders' | 'flows' | 'channels' | 'agents' | 'teams' | 'settings'

const SECTION_HREF: Partial<Record<CatalogSection, string>> = {
  folders: '/folders',
  flows: '/flows',
  channels: '/settings/channels',
  agents: '/agents',
  teams: '/team',
}

function folderNodes(rows: readonly NavRow[], parentId: string, prefs: SidebarLayoutPrefs): CatalogNode[] {
  return applyTreeOrder(rows, parentId, (row) => folderItemId(row.id), prefs, true).map((row) => {
    const id = folderItemId(row.id)
    return {
      id,
      parentId,
      label: row.name,
      hideKind: 'item' as const,
      hidden: prefs.hiddenItems.includes(id),
      children: folderNodes(row.children ?? [], id, prefs),
    }
  })
}

function itemNodes(
  rows: readonly { id: string; label: string }[],
  parentId: string,
  prefs: SidebarLayoutPrefs,
): CatalogNode[] {
  return applyOrder(rows, parentId, (row) => row.id, prefs, true).map((row) => ({
    id: row.id,
    parentId,
    label: row.label,
    hideKind: 'item' as const,
    hidden: prefs.hiddenItems.includes(row.id),
    children: [],
  }))
}

export function buildCommunicationCatalog(input: {
  labels: CatalogLabels
  sectionOrder: readonly CatalogSection[]
  hiddenSections: readonly string[]
  folders: readonly NavRow[]
  tags: readonly { id: string; label: string }[]
  flows: readonly { id: string; label: string }[]
  channels: readonly { id: string; label: string }[]
  agents: readonly { id: string; label: string }[]
  teams: readonly { id: string; label: string }[]
  prefs: SidebarLayoutPrefs
}): CatalogNode[] {
  const { labels, prefs } = input
  const hiddenSections = new Set(input.hiddenSections)
  const queues = itemNodes(
    INBOX_SIDEBAR_QUEUES.map((queue) => ({ id: queueItemId(queue), label: labels.queues[queue] })),
    INBOX_PARENT,
    prefs,
  )
  const inbox: CatalogNode = {
    id: INBOX_PARENT,
    parentId: 'root',
    label: labels.inbox,
    fixed: true,
    hideKind: 'none',
    children: queues,
  }
  const sections: CatalogNode[] = input.sectionOrder
    .filter((section) => section !== 'settings')
    .map((section) => {
      let children: CatalogNode[] = []
      if (section === 'folders') {
        children = [
          ...folderNodes(input.folders, 'folders', prefs),
          ...itemNodes(input.tags, FOLDER_TAGS_PARENT, prefs),
        ]
      } else if (section === 'flows') {
        children = itemNodes(input.flows, 'flows', prefs)
      } else if (section === 'channels') {
        children = itemNodes(input.channels, 'channels', prefs)
      } else if (section === 'agents') {
        children = itemNodes(input.agents, 'agents', prefs)
      } else if (section === 'teams') {
        children = itemNodes(input.teams, 'teams', prefs)
      }
      return {
        id: section,
        parentId: 'root',
        label: labels[section],
        href: SECTION_HREF[section],
        hideKind: 'section' as const,
        hidden: hiddenSections.has(section),
        children,
      }
    })
  const contacts: CatalogNode = {
    id: 'contacts',
    parentId: 'root',
    label: labels.contacts,
    fixed: true,
    hideKind: 'none',
    children: [],
  }
  const settings: CatalogNode = {
    id: 'settings',
    parentId: 'root',
    label: labels.settings,
    fixed: true,
    hideKind: 'section',
    hidden: hiddenSections.has('settings'),
    href: '/settings/channels',
    children: [],
  }
  return [inbox, ...sections, contacts, settings]
}

export function filterCatalog(nodes: readonly CatalogNode[], query: string): CatalogNode[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...nodes]
  const walk = (rows: readonly CatalogNode[], ancestorMatch: boolean): CatalogNode[] => {
    const out: CatalogNode[] = []
    for (const node of rows) {
      const self = node.label.toLowerCase().includes(needle)
      const showAllChildren = ancestorMatch || self
      const children = showAllChildren ? [...node.children] : walk(node.children, false)
      if (showAllChildren || children.length > 0) {
        out.push({ ...node, children })
      }
    }
    return out
  }
  return walk(nodes, false)
}

/** Identity of the tree without icons, so a republish does not loop on new elements. */
export function catalogStructureKey(nodes: readonly CatalogNode[]): string {
  return nodes
    .map((node) =>
      [node.id, node.label, node.hidden ? '1' : '0', node.parentId, catalogStructureKey(node.children)].join('\u001f'),
    )
    .join('\u001e')
}

/** If stored prefs hid both required queues, keep Alles visible. */
export function repairHiddenItems(hiddenItems: string[]): string[] {
  if (!hiddenItems.includes('queue:for_you') || !hiddenItems.includes('queue:open')) return hiddenItems
  return hiddenItems.filter((id) => id !== 'queue:open')
}
