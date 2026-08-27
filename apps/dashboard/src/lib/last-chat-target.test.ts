import { beforeEach, describe, expect, it } from 'vitest'
import { LAST_CHAT_TARGET_KEY, readLastChatTarget, writeLastChatTarget } from './last-chat-target'

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

describe('last chat target', () => {
  beforeEach(() => {
    memory.clear()
    installMemoryStorage()
  })

  it('stores and clears the last recipient', () => {
    writeLastChatTarget('  agent-1 ')
    expect(readLastChatTarget()).toBe('agent-1')
    writeLastChatTarget('')
    expect(readLastChatTarget()).toBe('')
    expect(memory.get(LAST_CHAT_TARGET_KEY)).toBeUndefined()
  })
})
