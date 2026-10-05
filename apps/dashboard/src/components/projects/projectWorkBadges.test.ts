import { describe, expect, it } from 'vitest'
import { canMoveQueueItem } from './projectWorkBadges'

describe('queue kanban moves', () => {
  it('allows the next legal status and rejects a skip from proposed', () => {
    expect(canMoveQueueItem('proposed', 'queued')).toBe(true)
    expect(canMoveQueueItem('proposed', 'running')).toBe(false)
    expect(canMoveQueueItem('queued', 'queued')).toBe(true)
    expect(canMoveQueueItem('verifying', 'completed')).toBe(true)
    expect(canMoveQueueItem('completed', 'proposed')).toBe(false)
  })
})
