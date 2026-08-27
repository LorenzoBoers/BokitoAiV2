import { describe, expect, it } from 'vitest'
import { parseUsageDays, usageBreakdownToCsv } from './usage-csv'
import type { UsageBreakdown } from './bokito-api'

const sample: UsageBreakdown = {
  days: 30,
  total_tokens: 100,
  total_provider_cost_micros: 1,
  total_customer_cost_micros: 2,
  by_model: [
    {
      model: 'claude-sonnet-4',
      provider: 'platform',
      key_source: 'platform',
      tokens: 80,
      provider_cost_micros: 1000,
      customer_cost_micros: 2000,
      billable: true,
    },
  ],
  by_agent: [{ agent_id: 'a1', agent_name: 'Support, EU', tokens: 50, customer_cost_micros: 1000 }],
  by_user: [{ user_id: 'u1', user_name: 'Ada', tokens: 20, customer_cost_micros: 400 }],
}

describe('usageBreakdownToCsv', () => {
  it('quotes names that contain commas', () => {
    const csv = usageBreakdownToCsv(sample)
    expect(csv).toContain('section,name,tokens,customer_cost_micros,billable')
    expect(csv).toContain('model,claude-sonnet-4,80,2000,yes')
    expect(csv).toContain('agent,"Support, EU",50,1000,')
    expect(csv).toContain('user,Ada,20,400,')
  })
})

describe('parseUsageDays', () => {
  it('accepts 7 and 90, defaults to 30', () => {
    expect(parseUsageDays('7')).toBe(7)
    expect(parseUsageDays('90')).toBe(90)
    expect(parseUsageDays('30')).toBe(30)
    expect(parseUsageDays(null)).toBe(30)
    expect(parseUsageDays('14')).toBe(30)
  })
})
