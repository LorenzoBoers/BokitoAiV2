/**
 * Lightweight cross-pane refresh for /folders: detail edits (tags, nest,
 * create/delete) live next to ProjectsFolderNav, which keeps its own list.
 */

export const FOLDERS_CHANGED_EVENT = 'bokito:folders-changed'

export type FoldersChangedDetail = {
  /** Folder that changed, when known. Listeners may ignore and reload all. */
  folderId?: string
}

export function notifyFoldersChanged(detail: FoldersChangedDetail = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(FOLDERS_CHANGED_EVENT, { detail }))
}

export function onFoldersChanged(handler: (detail: FoldersChangedDetail) => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const listener = (event: Event) => {
    const custom = event as CustomEvent<FoldersChangedDetail>
    handler(custom.detail ?? {})
  }
  window.addEventListener(FOLDERS_CHANGED_EVENT, listener)
  return () => window.removeEventListener(FOLDERS_CHANGED_EVENT, listener)
}
