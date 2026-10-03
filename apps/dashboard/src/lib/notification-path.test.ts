import { describe, expect, it } from 'vitest'
import { notificationSignalId, pathForNotification } from './notification-path'

describe('pathForNotification', () => {
  it('opens decision threads in For you', () => {
    expect(
      pathForNotification({
        kind: 'decision_request',
        payload: { signal_id: 'sig-1', channel: 'email' },
      }),
    ).toBe('/communication/inbox/for_you/t/sig-1')
  })

  it('opens internal decision threads in the same For you folder', () => {
    expect(
      pathForNotification({
        kind: 'decision_request',
        payload: { signal_id: 'sig-2', channel: 'internal', folder: 'internal' },
      }),
    ).toBe('/communication/inbox/for_you/t/sig-2')
  })

  it('deep-links to the decision card when the payload carries a message id', () => {
    expect(
      pathForNotification({
        kind: 'decision_request',
        payload: { signal_id: 'sig-3', message_id: 'msg-9', channel: 'email' },
      }),
    ).toBe('/communication/inbox/for_you/t/sig-3?message=msg-9')
  })

  it('accepts numeric thread ids in legacy payloads', () => {
    expect(notificationSignalId({ thread_id: 42 })).toBe('42')
  })

  it('falls back to For you when a decision has no signal id', () => {
    expect(
      pathForNotification({
        kind: 'decision_request',
        payload: { channel: 'email' },
      }),
    ).toBe('/communication/inbox/for_you')
  })
})
