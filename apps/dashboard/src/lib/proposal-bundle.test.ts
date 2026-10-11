import { describe, expect, it } from 'vitest'
import { normalizeBundleEntry, normalizeProposal } from './inbox-api'

const entry = {
  decision_id: 'd1',
  card_message_id: 'm1',
  title: 'Review: Create category #bug',
  summary: '',
  status: 'awaiting_human',
  chosen_option_id: null,
  resolved_at: null,
  approve_option_id: 'approve',
  reject_option_id: 'reject',
  action_type: 'accept_platform_change',
  action: { tool: 'create_category', key: 'create_category', args: { name: 'bug' }, fallback: 'Create category #bug' },
  learn: { tool: 'create_category', agent_id: 'a1' },
  platform_change_id: 'pc1',
}

describe('proposal bundle normalization', () => {
  it('reads every action row of a turn', () => {
    const proposal = normalizeProposal({
      decision_id: 'd2',
      status: 'awaiting_human',
      options: [],
      bundle: [entry, { ...entry, decision_id: 'd2', action: null, learn: null }],
      bundle_id: 'turn-1',
    })
    expect(proposal?.bundleId).toBe('turn-1')
    expect(proposal?.bundle.map((row) => row.decisionId)).toEqual(['d1', 'd2'])
    expect(proposal?.bundle[0].action?.args.name).toBe('bug')
    expect(proposal?.bundle[0].learn?.agentId).toBe('a1')
    expect(proposal?.bundle[1].action).toBeNull()
    expect(proposal?.bundle[1].learn).toBeNull()
  })

  it('leaves plain proposals without a bundle', () => {
    const proposal = normalizeProposal({ decision_id: 'd3', status: 'approved', options: [] })
    expect(proposal?.bundle).toEqual([])
    expect(proposal?.bundleId).toBeNull()
  })

  it('drops rows without a decision id and keeps a missing status readable', () => {
    expect(normalizeBundleEntry({ status: 'missing' })).toBeNull()
    const row = normalizeBundleEntry({ decision_id: 'd4', status: 'missing' })
    expect(row?.status).toBe('missing')
    expect(row?.approveOptionId).toBe('approve')
    expect(row?.rejectOptionId).toBe('reject')
  })
})
