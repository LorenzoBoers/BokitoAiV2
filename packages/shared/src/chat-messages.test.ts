import { describe, expect, it } from 'vitest'
import { isCustomerChannel, splitChatMessages } from './chat-messages.js'

describe('splitChatMessages', () => {
  it('starts a new message at every blank line', () => {
    expect(splitChatMessages('Hi Ann\n\nYour order ships today.\nTrack it below.')).toEqual([
      'Hi Ann',
      'Your order ships today.\nTrack it below.',
    ])
  })

  it('merges fragments shorter than three characters into the previous message', () => {
    expect(splitChatMessages('Thanks for waiting\n\nok')).toEqual(['Thanks for waiting\nok'])
  })

  it('drops a short restarted opener instead of two stutter bubbles', () => {
    expect(
      splitChatMessages('Je\n\nJe dashboardtaal is Nederlands. Je kunt dat zelf wijzigen.'),
    ).toEqual(['Je dashboardtaal is Nederlands. Je kunt dat zelf wijzigen.'])
  })

  it('joins a short non-restart opener into the next message', () => {
    expect(splitChatMessages('Ok\n\nIk regel dat vandaag.')).toEqual(['Ok\nIk regel dat vandaag.'])
  })

  it('caps the number of messages and joins the rest into the last', () => {
    const parts = splitChatMessages('one\n\ntwo\n\nthree\n\nfour\n\nfive\n\nsix', 5)
    expect(parts).toHaveLength(5)
    expect(parts[4]).toBe('five\n\nsix')
  })
})

describe('isCustomerChannel', () => {
  it('is false for assistant, internal and team threads', () => {
    expect(isCustomerChannel('assistant')).toBe(false)
    expect(isCustomerChannel('internal')).toBe(false)
    expect(isCustomerChannel('team')).toBe(false)
    expect(isCustomerChannel(undefined)).toBe(false)
    expect(isCustomerChannel('whatsapp')).toBe(true)
  })
})
