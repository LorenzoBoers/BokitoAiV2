import { beforeEach, describe, expect, it } from 'vitest'
import {
  DOCS_LAST_KEY,
  LEARN_LAST_KEY,
  readLastDocs,
  readLastLearn,
  writeLastDocs,
  writeLastLearn,
} from './docs-continue'

const memory = new Map<string, string>()

function installMemoryStorage() {
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value)
    },
    removeItem: (key: string) => {
      memory.delete(key)
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
}

describe('docs continue reading', () => {
  beforeEach(() => {
    memory.clear()
    installMemoryStorage()
  })

  it('stores the last Learn article', () => {
    writeLastLearn('cockpit', 'How Cockpit works')
    expect(readLastLearn()).toEqual({ path: '/learn/cockpit', title: 'How Cockpit works' })
  })

  it('stores the last public docs path', () => {
    writeLastDocs('/docs/getting-started/members', 'Invite the team')
    expect(readLastDocs()).toEqual({
      path: '/docs/getting-started/members',
      title: 'Invite the team',
    })
  })

  it('ignores empty writes', () => {
    writeLastLearn('  ', 'x')
    expect(readLastLearn()).toBeNull()
    expect(memory.get(LEARN_LAST_KEY)).toBeUndefined()
    expect(memory.get(DOCS_LAST_KEY)).toBeUndefined()
  })
})
