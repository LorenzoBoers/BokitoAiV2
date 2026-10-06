import { describe, expect, it } from 'vitest'
import { bulkDismissCandidates } from './decision-groups-api'

describe('bulkDismissCandidates', () => {
  it('keeps only kinds with more than one open card', () => {
    const groups = [
      { title: 'No reply needed', count: 97, withoutThread: 90, latestAt: null },
      { title: 'Send quote?', count: 1, withoutThread: 0, latestAt: null },
      { title: 'Turn on Banking?', count: 2, withoutThread: 2, latestAt: null },
    ]
    expect(bulkDismissCandidates(groups).map((g) => g.title)).toEqual(['No reply needed', 'Turn on Banking?'])
    expect(bulkDismissCandidates(groups, 10).map((g) => g.title)).toEqual(['No reply needed'])
  })
})
