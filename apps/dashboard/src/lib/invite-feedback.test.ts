import { describe, expect, it } from 'vitest'

import { inviteMailFeedback } from './invite-feedback'

describe('inviteMailFeedback', () => {
  it('reports success when the mail was sent', () => {
    const feedback = inviteMailFeedback('jane@example.com', {
      id: '1',
      mail_sent: true,
      invite_link: 'https://app.example.com/accept-invite?token=abc',
    })
    expect(feedback.kind).toBe('success')
    expect(feedback.message).toContain('jane@example.com')
  })

  it('warns with the copyable link when mail is not configured', () => {
    const feedback = inviteMailFeedback('jane@example.com', {
      id: '1',
      mail_sent: false,
      invite_link: 'https://app.example.com/accept-invite?token=abc',
    })
    expect(feedback.kind).toBe('warning')
    if (feedback.kind === 'warning') {
      expect(feedback.inviteLink).toBe('https://app.example.com/accept-invite?token=abc')
      expect(feedback.message).toContain('not sent')
      expect(feedback.message).toContain('copied')
    }
  })

  it('warns without a link when the response carries none', () => {
    const feedback = inviteMailFeedback('jane@example.com', { mail_sent: false })
    expect(feedback.kind).toBe('warning')
    if (feedback.kind === 'warning') {
      expect(feedback.inviteLink).toBeNull()
      expect(feedback.message).toContain('row actions')
    }
  })

  it('treats missing mail_sent as success (older responses)', () => {
    const feedback = inviteMailFeedback('jane@example.com', { id: '1' })
    expect(feedback.kind).toBe('success')
  })

  it('handles non-object responses without throwing', () => {
    expect(inviteMailFeedback('jane@example.com', null).kind).toBe('success')
    expect(inviteMailFeedback('jane@example.com', 'oops').kind).toBe('success')
  })
})
