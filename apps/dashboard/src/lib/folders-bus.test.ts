/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FOLDERS_CHANGED_EVENT, notifyFoldersChanged, onFoldersChanged } from './folders-bus'

describe('folders-bus', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('notifies listeners with folderId', () => {
    const seen: Array<{ folderId?: string }> = []
    const stop = onFoldersChanged((detail) => seen.push(detail))
    notifyFoldersChanged({ folderId: 'abc' })
    stop()
    notifyFoldersChanged({ folderId: 'ignored' })
    expect(seen).toEqual([{ folderId: 'abc' }])
  })

  it('dispatches the shared event name', () => {
    const spy = vi.fn()
    window.addEventListener(FOLDERS_CHANGED_EVENT, spy)
    notifyFoldersChanged()
    window.removeEventListener(FOLDERS_CHANGED_EVENT, spy)
    expect(spy).toHaveBeenCalledOnce()
  })
})
