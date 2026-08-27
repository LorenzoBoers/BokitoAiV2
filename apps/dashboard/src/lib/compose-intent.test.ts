import { describe, expect, it } from 'vitest'
import {
  canComposeToAddress,
  composeEmailPath,
  newAgentPath,
  newContactPath,
  parseComposeIntent,
  stripComposeIntent,
} from './compose-intent'

describe('compose intent', () => {
  it('builds a Communication URL that other pages can open', () => {
    expect(composeEmailPath({ to: 'ada@example.com' })).toBe(
      '/communication/inbox/open?compose=1&to=ada%40example.com',
    )
    expect(newContactPath()).toBe('/contacts?new=1')
    expect(newContactPath('ada@example.com')).toBe(
      '/contacts?new=1&address=ada%40example.com',
    )
    expect(newAgentPath()).toBe('/agents?new=1')
  })

  it('parses and strips compose query params', () => {
    const params = new URLSearchParams('compose=1&to=ada@example.com&project_id=p1')
    expect(parseComposeIntent(params)).toEqual({
      to: 'ada@example.com',
      subject: undefined,
      body: undefined,
    })
    expect(stripComposeIntent(params).get('project_id')).toBe('p1')
    expect(stripComposeIntent(params).get('compose')).toBeNull()
  })

  it('only offers email compose for mailbox-like addresses', () => {
    expect(canComposeToAddress('email', 'ada@example.com')).toBe(true)
    expect(canComposeToAddress('widget', 'ada@example.com')).toBe(true)
    expect(canComposeToAddress('whatsapp', '+31612345678')).toBe(false)
    expect(canComposeToAddress('slack', 'U123')).toBe(false)
    expect(canComposeToAddress('email', '')).toBe(false)
    expect(canComposeToAddress('widget', 'visitor@web')).toBe(false)
  })
})
