import { beforeEach, describe, expect, it } from 'vitest'
import { LAST_LOGIN_EMAIL_KEY, readLastLoginEmail, writeLastLoginEmail } from './last-login-email'

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

describe('last login email', () => {
  beforeEach(() => {
    memory.clear()
    installMemoryStorage()
  })

  it('stores and clears the last address', () => {
    writeLastLoginEmail('  ops@acme.com ')
    expect(readLastLoginEmail()).toBe('ops@acme.com')
    writeLastLoginEmail('')
    expect(readLastLoginEmail()).toBe('')
    expect(memory.get(LAST_LOGIN_EMAIL_KEY)).toBeUndefined()
  })
})
