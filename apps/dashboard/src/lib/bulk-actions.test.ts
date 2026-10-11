import { describe, expect, it } from 'vitest'
import { bulkActionsVisibility } from './bulk-actions'

describe('bulkActionsVisibility', () => {
  it('hides Close and promotes Reopen in Closed', () => {
    const v = bulkActionsVisibility('closed')
    expect(v.showClose).toBe(false)
    expect(v.showReopen).toBe(true)
    expect(v.primary).toBe('reopen')
    expect(v.showSpam).toBe(true)
  })

  it('hides Mark as spam and promotes Not spam in Spam', () => {
    const v = bulkActionsVisibility('spam')
    expect(v.showSpam).toBe(false)
    expect(v.showClose).toBe(false)
    expect(v.primary).toBe('not_spam')
    expect(v.showReopen).toBe(true)
  })

  it('hides Reopen in open folders', () => {
    for (const queue of ['open', 'for_you', 'unassigned', 'all'] as const) {
      const v = bulkActionsVisibility(queue)
      expect(v.showClose).toBe(true)
      expect(v.showReopen).toBe(false)
      expect(v.primary).toBe('close')
    }
  })

  it('keeps Close and Reopen in Scheduled', () => {
    const v = bulkActionsVisibility('scheduled')
    expect(v.showClose).toBe(true)
    expect(v.showReopen).toBe(true)
    expect(v.primary).toBe('close')
  })

  it('promotes Unpin and hides Pin on the Pinned filter', () => {
    const v = bulkActionsVisibility('open', 'pinned')
    expect(v.showPin).toBe(false)
    expect(v.showUnpin).toBe(true)
  })

  it('hides Mark unread on the Unread filter', () => {
    const v = bulkActionsVisibility('open', 'unread')
    expect(v.showRead).toBe(true)
    expect(v.showUnread).toBe(false)
  })

  it('keeps every disposition action when the folder is unknown', () => {
    const v = bulkActionsVisibility(null)
    expect(v.showClose).toBe(true)
    expect(v.showReopen).toBe(true)
    expect(v.showSpam).toBe(true)
  })
})
