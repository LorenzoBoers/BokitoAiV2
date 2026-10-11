import { beforeEach, describe, expect, it } from 'vitest'
import { readHiddenCalendars, writeHiddenCalendars } from './agenda-hidden-calendars'

describe('agenda hidden calendars', () => {
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

  it('round-trips hidden sub-calendars and drops junk', () => {
    writeHiddenCalendars(new Set(['conn-1|cal-a']))
    expect(readHiddenCalendars()).toEqual(new Set(['conn-1|cal-a']))
    globalThis.localStorage.setItem(
      'bokito.agenda.hiddenCalendars',
      JSON.stringify(['conn-1|cal-a', 'nope', 3]),
    )
    expect(readHiddenCalendars()).toEqual(new Set(['conn-1|cal-a']))
    writeHiddenCalendars(new Set())
    expect(readHiddenCalendars()).toEqual(new Set())
  })
})
