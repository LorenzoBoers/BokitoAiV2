import { describe, expect, it } from 'vitest'
import {
  decisionOptionLabelKey,
  matchSoftDecisionReply,
  optionIdForProposalItem,
  parseDecisionOptions,
  pickSoftDecisionTarget,
  stripChoiceEcho,
} from './decision-options'

describe('decision options', () => {
  it('parses options and drops rows without an id', () => {
    const options = parseDecisionOptions([
      { id: 'approve', label: 'Approve', action_type: 'restore_trash_item', learn: { tool: 't', rule_text: 'r' } },
      { label: 'no id' },
    ])
    expect(options).toHaveLength(1)
    expect(options[0].learn?.ruleText).toBe('r')
  })

  it('translates generic approve labels but keeps an agent-written one', () => {
    expect(decisionOptionLabelKey({ id: 'approve', label: 'Approve' })).toBe('approve')
    expect(decisionOptionLabelKey({ id: 'approve', label: 'Terugzetten' })).toBeNull()
    expect(decisionOptionLabelKey({ id: 'send', label: 'Send it' })).toBe('send')
  })

  it('maps showcase items to options via item_ref or matching id', () => {
    const options = [
      { id: 'opt-a', label: 'Website', item_ref: { type: 'conversation', id: 'sig-1' } },
      { id: 'sig-2', label: 'Session' },
    ]
    expect(optionIdForProposalItem({ type: 'conversation', id: 'sig-1' }, options)).toBe('opt-a')
    expect(optionIdForProposalItem({ type: 'conversation', id: 'sig-2' }, options)).toBe('sig-2')
    expect(optionIdForProposalItem({ type: 'project', id: 'p1' }, options)).toBeNull()
  })

  it('strips Kies hieronder choice lists that duplicate buttons', () => {
    expect(
      stripChoiceEcho('Wil je #lol verwijderen?\n\nKies hieronder:\n- **Ja**\n- **Nee**'),
    ).toBe('Wil je #lol verwijderen?')
    expect(stripChoiceEcho('Kies hieronder:\n- Ja\n- Nee')).toBe('')
  })

  it('maps soft Ja/Nee in the Ask box to the sole open proposal', () => {
    const options = parseDecisionOptions([
      { id: 'approve', label: 'Ja, verwijder' },
      { id: 'reject', label: 'Nee', action_type: 'reject' },
    ])
    expect(matchSoftDecisionReply('Ja', options)).toEqual({ kind: 'approve', optionId: 'approve' })
    expect(matchSoftDecisionReply('nee!', options)).toEqual({ kind: 'reject', optionId: 'reject' })
    expect(matchSoftDecisionReply('Ja graag', options)).toEqual({
      kind: 'approve',
      optionId: 'approve',
    })
    expect(matchSoftDecisionReply('Ja, verwijder', options)).toEqual({
      kind: 'approve',
      optionId: 'approve',
    })
    expect(matchSoftDecisionReply('misschien', options)).toBeNull()
    expect(
      matchSoftDecisionReply(
        'Ja',
        parseDecisionOptions([
          { id: 'a', label: '#a' },
          { id: 'b', label: '#b' },
          { id: 'reject', label: 'Geen', action_type: 'reject' },
        ]),
      ),
    ).toBeNull()
  })

  it('picks soft target only when exactly one open card is binary Ja/Nee', () => {
    const binary = parseDecisionOptions([
      { id: 'approve', label: 'Ja' },
      { id: 'reject', label: 'Nee', action_type: 'reject' },
    ])
    const multi = parseDecisionOptions([
      { id: 'a', label: '#a' },
      { id: 'b', label: '#b' },
      { id: 'reject', label: 'Geen', action_type: 'reject' },
    ])
    const text = parseDecisionOptions([
      { id: 'name', label: 'Naam typen', input_type: 'text' },
      { id: 'reject', label: 'Annuleren', action_type: 'reject' },
    ])
    expect(
      pickSoftDecisionTarget('Ja', [
        { messageId: 'm1', options: multi },
        { messageId: 'm2', options: binary },
        { messageId: 'm3', options: text },
      ])?.messageId,
    ).toBe('m2')
    expect(
      pickSoftDecisionTarget('Ja', [
        { messageId: 'm1', options: binary },
        { messageId: 'm2', options: binary },
      ]),
    ).toBeNull()
  })
})
