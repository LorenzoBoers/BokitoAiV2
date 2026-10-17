import { toast } from 'sonner'
import i18n from '../i18n'
import { isEditableKeyboardTarget } from './folder-move-undo'
import { openEntityPath } from './open-entity'

const UNDO_TOAST_MS = 12_000

type PendingBinUndo = {
  run: () => Promise<void>
  toastId: string | number
}

let pendingUndo: PendingBinUndo | null = null
let undoListener = false

function onUndoKey(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
  if (event.key !== 'z' && event.key !== 'Z') return
  if (isEditableKeyboardTarget(event.target)) return
  if (!pendingUndo) return
  event.preventDefault()
  void runPendingBinUndo()
}

function ensureUndoListener() {
  if (undoListener || typeof window === 'undefined') return
  undoListener = true
  window.addEventListener('keydown', onUndoKey)
}

async function runPendingBinUndo() {
  const current = pendingUndo
  if (!current) return
  pendingUndo = null
  toast.dismiss(current.toastId)
  await current.run()
}

/**
 * Success toast after a soft delete.
 * Pass `undo` to offer Undo (and Ctrl/Cmd+Z) instead of opening the Bin.
 */
export function toastMovedToBin(
  message: string,
  navigateOrUndo: ((to: string) => void) | { undo: () => Promise<void>; undoLabel: string },
) {
  if (typeof navigateOrUndo !== 'function') {
    ensureUndoListener()
    const id = toast.success(message, {
      duration: UNDO_TOAST_MS,
      action: {
        label: navigateOrUndo.undoLabel,
        onClick: () => {
          void runPendingBinUndo()
        },
      },
    })
    pendingUndo = { run: navigateOrUndo.undo, toastId: id }
    return
  }
  toast.success(message, {
    action: {
      label: i18n.t('binPage.openBin', { ns: 'nav' }),
      onClick: () => navigateOrUndo(openEntityPath({ type: 'trash_entry' })),
    },
  })
}
