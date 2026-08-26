import { describe, expect, it } from 'vitest'
import { notificationSignalId, pathForNotification } from './notification-path'

describe('pathForNotification', () => {
  it('opens external threads on All with the signal id', () => {
    expect(
      pathForNotification({
        kind: 'decision_request',
        payload: { signal_id: 'sig-1', channel: 'email' },
      }),
    ).toBe('/communication/inbox/all/t/sig-1')
  })

  it('opens internal decision threads on Agent runs awaiting decision', () => {
    expect(
      pathForNotification({
        kind: 'decision_request',
        payload: { signal_id: 'sig-2', channel: 'internal', folder: 'internal' },
      }),
    ).toBe('/communication/runs/awaiting-decision/t/sig-2')
  })

  it('accepts numeric thread ids in legacy payloads', () => {
    expect(notificationSignalId({ thread_id: 42 })).toBe('42')
  })

  it('falls back to inbox All when a decision has no signal id', () => {
    expect(
      pathForNotification({
        kind: 'decision_request',
        payload: { channel: 'email' },
      }),
    ).toBe('/communication/inbox/all')
  })
})
