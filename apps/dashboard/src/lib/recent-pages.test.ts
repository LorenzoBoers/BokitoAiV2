import { beforeEach, describe, expect, it } from 'vitest'
import {
  listRecentPages,
  recentLocationKey,
  recordRecentPage,
  RECENT_PAGES_KEY,
  shouldRecordRecentPage,
} from './recent-pages'

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

describe('recent pages', () => {
  beforeEach(() => {
    memory.clear()
    installMemoryStorage()
  })

  it('keeps only stable query keys so compose intents are not stored', () => {
    expect(recentLocationKey('/communication/inbox/all', '?compose=1&to=a@b.com')).toBe(
      '/communication/inbox/all',
    )
    expect(recentLocationKey('/settings/govern', '?tab=policy')).toBe('/settings/govern?tab=policy')
    expect(recentLocationKey('/contacts/', '?view=companies')).toBe('/contacts?view=companies')
    expect(recentLocationKey('/communication/inbox/all/t/abc-123')).toBe('/communication/inbox/all')
  })

  it('skips auth routes', () => {
    expect(shouldRecordRecentPage('/login')).toBe(false)
    expect(shouldRecordRecentPage('/cockpit')).toBe(true)
  })

  it('moves a revisited page to the front and caps the list', () => {
    recordRecentPage('/cockpit', 'Cockpit')
    recordRecentPage('/contacts', 'Contacts')
    recordRecentPage('/cockpit', 'Cockpit')
    const pages = listRecentPages()
    expect(pages[0]?.path).toBe('/cockpit')
    expect(pages.map((row) => row.path)).toEqual(['/cockpit', '/contacts'])
    expect(memory.get(RECENT_PAGES_KEY)).toContain('/cockpit')
  })
})
