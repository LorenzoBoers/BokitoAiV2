import { describe, expect, it } from 'vitest'
import { threadPatchHasMeaning } from './thread-events'

describe('threadPatchHasMeaning', () => {
  it('is false for empty or metadata-only patches', () => {
    expect(threadPatchHasMeaning(null)).toBe(false)
    expect(threadPatchHasMeaning({})).toBe(false)
    expect(threadPatchHasMeaning({ actor: 'user' })).toBe(false)
  })

  it('is true when status, assignee, priority or tags change', () => {
    expect(threadPatchHasMeaning({ status: 'closed' })).toBe(true)
    expect(threadPatchHasMeaning({ assigned_to: 3 })).toBe(true)
    expect(threadPatchHasMeaning({ priority: 'high' })).toBe(true)
    expect(threadPatchHasMeaning({ tags: [] })).toBe(true)
    expect(threadPatchHasMeaning({ bulk: 'reopen' })).toBe(true)
  })
})
