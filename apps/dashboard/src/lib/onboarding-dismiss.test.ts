import { beforeEach, describe, expect, it } from 'vitest'
import {
  onboardingDismissKey,
  readOnboardingDismissed,
  writeOnboardingDismissed,
} from './onboarding-dismiss'

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

describe('onboarding dismiss', () => {
  const tenant = 'tenant-1'

  beforeEach(() => {
    memory.clear()
    installMemoryStorage()
  })

  it('scopes the key per tenant', () => {
    expect(onboardingDismissKey(tenant)).toBe('bokito-onboarding-dismissed:tenant-1')
    expect(onboardingDismissKey(null)).toBe('bokito-onboarding-dismissed:default')
  })

  it('can hide and show the setup card again', () => {
    expect(readOnboardingDismissed(tenant)).toBe(false)
    writeOnboardingDismissed(tenant, true)
    expect(readOnboardingDismissed(tenant)).toBe(true)
    writeOnboardingDismissed(tenant, false)
    expect(readOnboardingDismissed(tenant)).toBe(false)
  })
})
