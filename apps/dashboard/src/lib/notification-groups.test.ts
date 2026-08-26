import { describe, expect, it } from 'vitest'
import { collapseNotifications, notificationGroupKey } from './notification-groups'

const item = (id: string, createdAt: string, extras: Record<string, unknown> = {}) => ({
  id,
  kind: 'decision_request',
  title: 'Reply to customer message',
  body: 'Draft reply prepared for review.',
  status: 'unread',
  payload: { signal_id: 'sig-1' },
  createdAt,
  ...extras,
})

describe('notificationGroupKey', () => {
  it('groups the same decision on the same thread', () => {
    expect(notificationGroupKey(item('a', '2026-07-01T00:00:00Z'))).toBe(
      notificationGroupKey(item('b', '2026-07-24T00:00:00Z')),
    )
  })

  it('keeps different threads apart', () => {
    expect(
      notificationGroupKey(
        item('a', '2026-07-01T00:00:00Z', { payload: { signal_id: 'sig-1' } }),
      ),
    ).not.toBe(
      notificationGroupKey(
        item('b', '2026-07-01T00:00:00Z', { payload: { signal_id: 'sig-2' } }),
      ),
    )
  })
})

describe('collapseNotifications', () => {
  it('keeps the newest card and the sibling ids', () => {
    const grouped = collapseNotifications([
      item('old', '2026-07-01T00:00:00Z'),
      item('new', '2026-07-24T00:00:00Z'),
      item('mid', '2026-07-10T00:00:00Z'),
    ])
    expect(grouped).toHaveLength(1)
    expect(grouped[0]?.id).toBe('new')
    expect(grouped[0]?.count).toBe(3)
    expect(grouped[0]?.ids).toEqual(['old', 'new', 'mid'])
  })
})
