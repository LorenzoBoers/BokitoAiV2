import { describe, expect, it } from 'vitest'
import { isCustomerChannel, splitChatMessages } from './chatMessages'

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

  it('drops blocks without text, such as a lone horizontal rule', () => {
    expect(
      splitChatMessages('Hier zijn suggesties:\n\n---\n\n#### Actietags\n- #feature\n\n***\n\n**', 0),
    ).toEqual(['Hier zijn suggesties:', '#### Actietags\n- #feature'])
  })

  it('keeps fenced code in one message', () => {
    expect(splitChatMessages('Run this:\n\n```\na\n\nb\n```')).toEqual(['Run this:', '```\na\n\nb\n```'])
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
    expect(isCustomerChannel('email')).toBe(true)
  })
})
