import { describe, expect, it } from 'vitest'
import { moduleProposalFromOptions } from './module-proposal'

describe('moduleProposalFromOptions', () => {
  it('summarizes a party proposal from the apply option payload', () => {
    const proposal = moduleProposalFromOptions([
      {
        action_type: 'accounting_apply_party',
        payload: {
          role: 'customer',
          name: 'Bokito Test BV',
          email: 'test@bokito.ai',
          company_id: '20176e9a-63d6-4f3c-bceb-38d6de083125',
          company_label: '2635 - Demo CSW',
        },
      },
      { action_type: 'reject' },
    ])
    expect(proposal?.module).toBe('accounting')
    expect(proposal?.kind).toBe('party')
    expect(proposal?.rows).toEqual([
      { label: 'company', value: '2635 - Demo CSW' },
      { label: 'role', value: 'customer' },
      { label: 'name', value: 'Bokito Test BV' },
      { label: 'email', value: 'test@bokito.ai' },
    ])
  })

  it('totals booking lines', () => {
    const proposal = moduleProposalFromOptions([
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

  it('handles any module slug without UI changes', () => {
    const proposal = moduleProposalFromOptions([
      {
        action_type: 'banking_apply_payment',
        payload: { amount: 1250, counterparty: 'Belastingdienst' },
      },
    ])
    expect(proposal?.module).toBe('banking')
    expect(proposal?.kind).toBe('payment')
    expect(proposal?.rows).toContainEqual({ label: 'amount', value: '1250' })
  })

  it('returns null without a module apply option', () => {
    expect(moduleProposalFromOptions([{ action_type: 'send_reply', payload: {} }])).toBeNull()
    expect(moduleProposalFromOptions([])).toBeNull()
  })
})
