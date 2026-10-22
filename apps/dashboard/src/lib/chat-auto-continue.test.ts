import { beforeEach, describe, expect, it } from 'vitest'
import { peekChatContinue, stashChatContinue, takeChatContinue } from './chat-auto-continue'

function mockSessionStorage() {
  const store = new Map<string, string>()
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => store.clear(),
  }
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage })
  return storage
}

describe('chat-auto-continue', () => {
  beforeEach(() => {
    mockSessionStorage()
  })

  it('stashes and consumes a continue flag once', () => {
    stashChatContinue('t1', { mode: 'continue' })
    expect(peekChatContinue('t1')).toBe(true)
    expect(takeChatContinue('t1')).toEqual({ mode: 'continue' })
    expect(takeChatContinue('t1')).toBeNull()
    expect(peekChatContinue('t1')).toBe(false)
  })

  it('stashes a speak-first flag once', () => {
    stashChatContinue('t4', { mode: 'speak' })
    expect(takeChatContinue('t4')).toEqual({ mode: 'speak' })
    expect(takeChatContinue('t4')).toBeNull()
  })

  it('stashes a send draft with trimmed text', () => {
    stashChatContinue('t2', { mode: 'send', text: '  hello agent  ' })
    expect(takeChatContinue('t2')).toEqual({ mode: 'send', text: 'hello agent' })
  })

  it('ignores empty send drafts', () => {
    sessionStorage.setItem('bokito:chat-continue:t3', JSON.stringify({ mode: 'send', text: '   ' }))
    expect(takeChatContinue('t3')).toBeNull()
  })
})
