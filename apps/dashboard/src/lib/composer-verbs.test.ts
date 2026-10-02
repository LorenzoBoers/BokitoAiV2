import { describe, expect, it } from 'vitest'
import { isAiHandlingVerb, parseComposerVerb } from './composer-verbs'

describe('parseComposerVerb', () => {
  it('parses AI handling verbs with an optional reason', () => {
    expect(parseComposerVerb('/manual vip customer')).toEqual({
      verb: 'manual',
      arg: 'vip customer',
      rest: 'vip customer',
    })
    expect(parseComposerVerb('/Autonomous')?.verb).toBe('autonomous')
  })

  it('maps Dutch aliases to the same verbs', () => {
    expect(parseComposerVerb('/handmatig')?.verb).toBe('manual')
    expect(parseComposerVerb('/geassisteerd')?.verb).toBe('assisted')
    expect(parseComposerVerb('/autonoom')?.verb).toBe('autonomous')
  })

  it('ignores unknown verbs and plain text', () => {
    expect(parseComposerVerb('/unknown')).toBeNull()
    expect(parseComposerVerb('hello /manual')).toBeNull()
  })

  it('flags only the AI handling verbs', () => {
    expect(isAiHandlingVerb('assisted')).toBe(true)
    expect(isAiHandlingVerb('assign')).toBe(false)
  })
})
