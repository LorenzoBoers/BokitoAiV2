import { describe, expect, it } from 'vitest'
import { viewingSignal } from './NotificationContext'

describe('viewingSignal', () => {
  const id = '2993a271-1a09-4526-b5dd-49093ff96575'

  it('matches an open thread path segment', () => {
    expect(viewingSignal(id, `/communication/inbox/open/t/${id}`)).toBe(true)
  })

  it('matches when the id is URI-encoded in the path', () => {
    expect(viewingSignal(id, `/communication/inbox/open/t/${encodeURIComponent(id)}`)).toBe(true)
  })

  it('does not match a prefix of another id', () => {
    expect(viewingSignal(id, `/communication/inbox/open/t/${id}ff`)).toBe(false)
  })

  it('returns false when the thread is not open', () => {
    expect(viewingSignal(id, '/communication/inbox/open')).toBe(false)
    expect(viewingSignal(null, `/communication/inbox/open/t/${id}`)).toBe(false)
  })
})
