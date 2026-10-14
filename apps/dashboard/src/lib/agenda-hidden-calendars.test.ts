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
    const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    writeHiddenCalendars(new Set(['conn-1|cal-a', uuid]))
    expect(readHiddenCalendars()).toEqual(new Set(['conn-1|cal-a', uuid]))
    globalThis.localStorage.setItem(
      'bokito.agenda.hiddenCalendars',
      JSON.stringify(['conn-1|cal-a', uuid, 'nope', 3]),
    )
    expect(readHiddenCalendars()).toEqual(new Set(['conn-1|cal-a', uuid]))
    writeHiddenCalendars(new Set())
    expect(readHiddenCalendars()).toEqual(new Set())
  })
})
