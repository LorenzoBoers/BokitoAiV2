/**
 * Last folder drag (nest / reorder) can be undone from the toast or Ctrl/Cmd+Z.
 * One slot only — each new move replaces the previous undo.
 */

export type FolderMoveUndo = {
  /** Short description for a11y / future UI. */
  label: string
  run: () => Promise<void>
}

let pending: FolderMoveUndo | null = null
let toastId: string | number | undefined

export function setFolderMoveUndo(action: FolderMoveUndo | null, nextToastId?: string | number) {
  pending = action
  toastId = nextToastId
}

export function clearFolderMoveUndo() {
  pending = null
  toastId = undefined
}

export function hasFolderMoveUndo(): boolean {
  return pending != null
}

export function peekFolderMoveUndo(): FolderMoveUndo | null {
  return pending
}

export function takeFolderMoveUndoToastId(): string | number | undefined {
  const id = toastId
  toastId = undefined
  return id
}

/** Run and clear the pending undo. Returns false when nothing to undo. */
export async function runFolderMoveUndo(): Promise<boolean> {
  if (!pending) return false
  const action = pending
  pending = null
  toastId = undefined
  await action.run()
  return true
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (target == null || typeof target !== 'object') return false
  const el = target as { isContentEditable?: boolean; tagName?: string }
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
