import { describe, expect, it } from 'vitest'
import { normalizeInboxRule, normalizeRuleSuggestion } from './signals-api'

const apiRule = {
  id: 'rule-1',
  match_type: 'sender',
  match_value: 'noreply@github.com',
  label: 'GitHub notifications',
  action: 'auto_close',
  status: 'suggested',
  source: 'learned',
  observations: 3,
  promotion_threshold: 3,
  hit_count: 0,
  last_hit_at: null,
  created_at: '2026-08-19T10:00:00Z',
  updated_at: '2026-08-19T10:05:00Z',
}

describe('normalizeInboxRule', () => {
  it('maps a serialized rule to the camelCase shape', () => {
    const rule = normalizeInboxRule(apiRule)
    expect(rule).not.toBeNull()
    expect(rule?.matchType).toBe('sender')
    expect(rule?.matchValue).toBe('noreply@github.com')
    expect(rule?.action).toBe('auto_close')
    expect(rule?.status).toBe('suggested')
    expect(rule?.observations).toBe(3)
    expect(rule?.promotionThreshold).toBe(3)
  })

  it('rejects payloads with unknown match types or actions', () => {
    expect(normalizeInboxRule({ ...apiRule, match_type: 'subject' })).toBeNull()
    expect(normalizeInboxRule({ ...apiRule, action: 'explode' })).toBeNull()
    expect(normalizeInboxRule(null)).toBeNull()
    expect(normalizeInboxRule('nope')).toBeNull()
    expect(normalizeInboxRule({})).toBeNull()
  })

  it('defaults unexpected status to suggested', () => {
    expect(normalizeInboxRule({ ...apiRule, status: 'weird' })?.status).toBe('suggested')
    expect(normalizeInboxRule({ ...apiRule, status: 'active' })?.status).toBe('active')
    expect(normalizeInboxRule({ ...apiRule, status: 'paused' })?.status).toBe('paused')
  })
})

describe('normalizeRuleSuggestion', () => {
  it('carries the promotion flags used by the inline prompt', () => {
    const suggestion = normalizeRuleSuggestion({
      ...apiRule,
      ready_to_activate: true,
      auto_promoted: false,
    })
    expect(suggestion?.readyToActivate).toBe(true)
    expect(suggestion?.autoPromoted).toBe(false)
  })

  it('treats missing flags as false and invalid rules as null', () => {
    const suggestion = normalizeRuleSuggestion(apiRule)
    expect(suggestion?.readyToActivate).toBe(false)
    expect(suggestion?.autoPromoted).toBe(false)
    expect(normalizeRuleSuggestion(null)).toBeNull()
  })
})
