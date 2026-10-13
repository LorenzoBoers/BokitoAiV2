import { describe, expect, it } from 'vitest'
import {
  clearFolderMoveUndo,
  hasFolderMoveUndo,
  isEditableKeyboardTarget,
  runFolderMoveUndo,
  setFolderMoveUndo,
} from './folder-move-undo'

describe('folder-move-undo', () => {
  it('runs and clears the pending undo', async () => {
    clearFolderMoveUndo()
    let ran = 0
    setFolderMoveUndo({
      label: 'nest',
      run: async () => {
        ran += 1
      },
    })
    expect(hasFolderMoveUndo()).toBe(true)
    await expect(runFolderMoveUndo()).resolves.toBe(true)
    expect(ran).toBe(1)
    expect(hasFolderMoveUndo()).toBe(false)
    await expect(runFolderMoveUndo()).resolves.toBe(false)
  })

  it('detects editable keyboard targets without DOM', () => {
    expect(isEditableKeyboardTarget(null)).toBe(false)
    expect(isEditableKeyboardTarget({ tagName: 'INPUT' } as EventTarget)).toBe(true)
    expect(isEditableKeyboardTarget({ tagName: 'DIV' } as EventTarget)).toBe(false)
    expect(isEditableKeyboardTarget({ isContentEditable: true } as EventTarget)).toBe(true)
  })
})
