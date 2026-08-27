import { describe, expect, it } from 'vitest'
import {
  activitySearchParams,
  parseActivityDetail,
  parseActivityFollow,
  parseActivitySource,
} from './activity-filters'

describe('activity filters', () => {
  it('parses known source and detail values', () => {
    expect(parseActivitySource('people')).toBe('people')
    expect(parseActivitySource('junk')).toBe('all')
    expect(parseActivityDetail(null)).toBe('headlines')
    expect(parseActivityDetail('all')).toBe('all')
    expect(parseActivityFollow('0')).toBe(false)
    expect(parseActivityFollow(null)).toBe(true)
  })

  it('omits default params from the URL', () => {
    const next = activitySearchParams(new URLSearchParams('source=agents&follow=0'), {
      source: 'all',
      detail: 'headlines',
      q: '',
      follow: true,
    })
    expect(next.toString()).toBe('')
  })

  it('keeps non-default filters', () => {
    const next = activitySearchParams(new URLSearchParams(), {
      source: 'people',
      detail: 'all',
      q: 'mailbox',
      follow: false,
    })
    expect(next.get('source')).toBe('people')
    expect(next.get('detail')).toBe('all')
    expect(next.get('q')).toBe('mailbox')
    expect(next.get('follow')).toBe('0')
  })
})
