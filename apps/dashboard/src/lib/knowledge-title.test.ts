import { describe, expect, it } from 'vitest'
import { humanizeKnowledgeTitle } from './knowledge-title'

describe('humanizeKnowledgeTitle', () => {
  it('drops a duplicated path prefix', () => {
    expect(humanizeKnowledgeTitle('Company / Company Bokito AI OS persona')).toBe(
      'Company Bokito AI OS persona',
    )
  })

  it('keeps the last useful segment', () => {
    expect(humanizeKnowledgeTitle('Skills / Email tone')).toBe('Email tone')
  })

  it('returns empty for blank titles', () => {
    expect(humanizeKnowledgeTitle('  ')).toBe('')
  })
})
