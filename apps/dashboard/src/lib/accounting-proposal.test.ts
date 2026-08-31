import { describe, expect, it } from 'vitest'
import { accountingProposalFromOptions } from './accounting-proposal'

describe('accountingProposalFromOptions', () => {
  it('summarizes a party proposal from the apply option payload', () => {
    const proposal = accountingProposalFromOptions([
      {
        action_type: 'accounting_apply_party',
        payload: {
          role: 'customer',
          name: 'Bokito Test BV',
          email: 'test@bokito.ai',
          company_id: '2635',
        },
      },
      { action_type: 'reject' },
    ])
    expect(proposal?.kind).toBe('party')
    expect(proposal?.rows).toEqual([
      { label: 'company', value: '2635' },
      { label: 'party', value: 'Bokito Test BV' },
      { label: 'kind', value: 'customer' },
      { label: 'email', value: 'test@bokito.ai' },
    ])
  })

  it('totals booking lines', () => {
    const proposal = accountingProposalFromOptions([
      {
        action_type: 'accounting_apply_booking',
        payload: {
          description: 'Test memoriaal',
          lines: [{ amount: 100 }, { amount: -100 }],
        },
      },
    ])
    expect(proposal?.kind).toBe('booking')
    expect(proposal?.rows).toContainEqual({ label: 'lines', value: '2 — 100.00' })
  })

  it('returns null without an accounting apply option', () => {
    expect(accountingProposalFromOptions([{ action_type: 'send_reply', payload: {} }])).toBeNull()
    expect(accountingProposalFromOptions([])).toBeNull()
  })
})
