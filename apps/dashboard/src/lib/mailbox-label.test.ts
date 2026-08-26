import { describe, expect, it } from 'vitest'
import { mailboxDisplayLabel } from './mailbox-label'

describe('mailboxDisplayLabel', () => {
  it('collapses a repeated workspace name in parentheses', () => {
    expect(mailboxDisplayLabel('Bokito (Bokito)', 'hello@bokito.ai')).toBe('Bokito')
  })

  it('keeps a distinct name when the parenthesis is the address', () => {
    expect(mailboxDisplayLabel('Support (hello@bokito.ai)', 'hello@bokito.ai')).toBe('Support')
  })

  it('falls back to the mailbox address when the title is empty', () => {
    expect(mailboxDisplayLabel('', 'hello@bokito.ai')).toBe('hello@bokito.ai')
    expect(mailboxDisplayLabel(null, 'hello@bokito.ai')).toBe('hello@bokito.ai')
  })

  it('returns a unique display name unchanged', () => {
    expect(mailboxDisplayLabel('Customer mailbox', 'hello@bokito.ai')).toBe('Customer mailbox')
  })
})
