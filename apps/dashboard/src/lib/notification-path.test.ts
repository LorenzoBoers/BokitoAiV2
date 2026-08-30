import { describe, expect, it } from 'vitest'
import { notificationSignalId, pathForNotification } from './notification-path'

describe('pathForNotification', () => {
  it('opens decision threads on the Decisions leaf with the signal id', () => {
    expect(
      pathForNotification({
        kind: 'decision_request',
        payload: { signal_id: 'sig-1', channel: 'email' },
      }),
    ).toBe('/communication/decisions/t/sig-1')
  })

  it('opens internal decision threads on the same Decisions leaf', () => {
    expect(
      pathForNotification({
        kind: 'decision_request',
        payload: { signal_id: 'sig-2', channel: 'internal', folder: 'internal' },
      }),
    ).toBe('/communication/decisions/t/sig-2')
  })

  it('accepts numeric thread ids in legacy payloads', () => {
    expect(notificationSignalId({ thread_id: 42 })).toBe('42')
  })

  it('falls back to Decisions when a decision has no signal id', () => {
    expect(
      pathForNotification({
        kind: 'decision_request',
        payload: { channel: 'email' },
      }),
    ).toBe('/communication/decisions')
  })
})
