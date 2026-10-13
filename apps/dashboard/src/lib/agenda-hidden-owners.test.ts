import { beforeEach, describe, expect, it } from 'vitest'
import { readHiddenOwners, writeHiddenOwners } from './agenda-hidden-owners'

describe('agenda hidden owners', () => {
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value)
        },
        removeItem: (key: string) => {
          store.delete(key)
        },
      },
    })
  })

  it('round-trips hidden people and agents and drops junk', () => {
    writeHiddenOwners(new Set(['user:u1', 'agent:a1']))
    expect(readHiddenOwners()).toEqual(new Set(['user:u1', 'agent:a1']))
    globalThis.localStorage.setItem(
      'bokito.agenda.hiddenOwners',
      JSON.stringify(['user:u1', 'team:t1', 'nope', 3]),
    )
    expect(readHiddenOwners()).toEqual(new Set(['user:u1']))
    writeHiddenOwners(new Set())
    expect(readHiddenOwners()).toEqual(new Set())
  })
})
