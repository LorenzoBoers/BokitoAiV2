import { describe, expect, it } from 'vitest'

import en from './en.json'
import nl from './nl.json'

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k
    return v && typeof v === 'object' ? flatten(v as Record<string, unknown>, key) : [key]
  })
}

describe('locales', () => {
  it('en and nl expose the same keys', () => {
    const a = flatten(en).sort()
    const b = flatten(nl).sort()
    expect(b).toEqual(a)
  })

  it('placeholders match between languages', () => {
    const grab = (o: Record<string, unknown>) =>
      Object.fromEntries(
        flatten(o).map((key) => {
          const value = key.split('.').reduce<unknown>((acc, part) => (acc as Record<string, unknown>)[part], o)
          return [key, [...String(value).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()]
        }),
      )
    expect(grab(nl)).toEqual(grab(en))
  })

  it('contains no emoji', () => {
    const emoji = /\p{Extended_Pictographic}/u
    for (const value of [JSON.stringify(en), JSON.stringify(nl)]) {
      expect(emoji.test(value)).toBe(false)
    }
  })
})
