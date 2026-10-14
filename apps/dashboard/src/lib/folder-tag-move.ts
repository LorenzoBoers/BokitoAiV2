import { filtersetPlainLabel } from './folder-filter-tree'

export const TAG_DRAG_PREFIX = 'tag:'

function bareTag(name: string): string {
  return name.replace(/^#/, '').trim()
}

export type FolderTagSource = {
  id: string
  name: string
  tag_names?: string[] | null
  tag_ids?: string[] | null
}

/** Draggable chip id: tag:{folderId}:{urlencodedTag} */
export function tagDragId(folderId: string, tag: string): string {
  return `${TAG_DRAG_PREFIX}${folderId}:${encodeURIComponent(bareTag(tag))}`
}

export function isTagDragId(id: string | null | undefined): boolean {
  return id != null && String(id).startsWith(TAG_DRAG_PREFIX)
}

export function parseTagDragId(id: string | null | undefined): { folderId: string; tag: string } | null {
  const raw = id == null ? '' : String(id)
  if (!raw.startsWith(TAG_DRAG_PREFIX)) return null
  const rest = raw.slice(TAG_DRAG_PREFIX.length)
  const sep = rest.indexOf(':')
  if (sep <= 0) return null
  const folderId = rest.slice(0, sep)
  let tag = ''
  try {
    tag = decodeURIComponent(rest.slice(sep + 1))
  } catch {
    tag = rest.slice(sep + 1)
  }
  tag = bareTag(tag)
  if (!folderId || !tag) return null
  return { folderId, tag }
}

/** Folder whose filterset is exactly one tag (order/case-insensitive). */
export function findExactTagFolder<T extends FolderTagSource>(
  sources: T[],
  tag: string,
): T | undefined {
  const needle = bareTag(tag).toLowerCase()
  if (!needle) return undefined
  return sources.find((source) => {
    const names = (source.tag_names ?? []).map(bareTag).filter(Boolean)
    return names.length === 1 && names[0]!.toLowerCase() === needle
  })
}

/** Remove one tag from a folder's filterset; null if that would empty it. */
export function optimisticRemoveTag<T extends FolderTagSource>(
  sources: T[],
  fromId: string,
  tag: string,
): T[] | null {
  const needle = bareTag(tag).toLowerCase()
  if (!needle) return null
  const from = sources.find((source) => source.id === fromId)
  if (!from) return null
  const fromNames = (from.tag_names ?? []).map(bareTag).filter(Boolean)
  const dropAt = fromNames.findIndex((name) => name.toLowerCase() === needle)
  if (dropAt < 0) return null
  const nextFrom = fromNames.filter((_, index) => index !== dropAt)
  if (!nextFrom.length) return null
  const fromIds = from.tag_ids ?? []
  const parallel = fromIds.length === fromNames.length
  const nextIds = parallel ? fromIds.filter((_, index) => index !== dropAt) : fromIds
  return sources.map((source) =>
    source.id === fromId
      ? {
          ...source,
          tag_names: nextFrom,
          ...(parallel ? { tag_ids: nextIds } : {}),
          name: filtersetPlainLabel(nextFrom) || source.name,
        }
      : source,
  )
}

/** Move one tag from source folder's filterset into the target folder's. */
export function optimisticMoveTag<T extends FolderTagSource>(
  sources: T[],
  fromId: string,
  toId: string,
  tag: string,
): T[] | null {
  if (fromId === toId) return null
  const to = sources.find((source) => source.id === toId)
  const from = sources.find((source) => source.id === fromId)
  if (!from || !to) return null
  const fromNames = (from.tag_names ?? []).map(bareTag).filter(Boolean)
  const fromIds = from.tag_ids ?? []
  const needle = bareTag(tag).toLowerCase()
  const dropAt = fromNames.findIndex((name) => name.toLowerCase() === needle)
  const movedId =
    dropAt >= 0 && fromIds.length === fromNames.length ? fromIds[dropAt] : undefined
  const stripped = optimisticRemoveTag(sources, fromId, tag)
  if (!stripped) return null
  const toNames = (to.tag_names ?? []).map(bareTag).filter(Boolean)
  const toIds = to.tag_ids ?? []
  const already = toNames.some((name) => name.toLowerCase() === needle)
  const nextTo = already ? toNames : [...toNames, bareTag(tag)]
  const toParallel = toIds.length === toNames.length
  const nextToIds = already ? toIds : toParallel && movedId != null ? [...toIds, movedId] : toIds
  return stripped.map((source) =>
    source.id === toId
      ? {
          ...source,
          tag_names: nextTo,
          ...(already || (toParallel && movedId != null) ? { tag_ids: nextToIds } : {}),
          name: filtersetPlainLabel(nextTo) || source.name,
        }
      : source,
  )
}
