import { describe, expect, it } from 'vitest'
import { appendSpeechChunk, consumeSpeechResults } from '@bokito/shared'

describe('appendSpeechChunk', () => {
  it('joins with a single space', () => {
    expect(appendSpeechChunk('Hallo', 'wereld')).toBe('Hallo wereld')
  })

  it('skips an exact duplicate of the trailing phrase', () => {
    expect(appendSpeechChunk('Ja wat is het voor gesprek', 'Ja wat is het voor gesprek')).toBe(
      'Ja wat is het voor gesprek',
    )
  })

  it('skips when the chunk is already the suffix', () => {
    expect(
      appendSpeechChunk(
        'blabla Ja wat is het voor gesprek',
        'Ja wat is het voor gesprek',
      ),
    ).toBe('blabla Ja wat is het voor gesprek')
  })

  it('normalizes whitespace in the chunk', () => {
    expect(appendSpeechChunk('A', '  b   c  ')).toBe('A b c')
  })

  it('ignores empty chunks', () => {
    expect(appendSpeechChunk('blijft', '   ')).toBe('blijft')
  })
})

describe('consumeSpeechResults', () => {
  it('commits each final index once and keeps interim separate', () => {
    const first = consumeSpeechResults(
      [
        { isFinal: true, transcript: 'Hallo' },
        { isFinal: false, transcript: ' wereld' },
      ],
      0,
    )
    expect(first.finalChunk).toBe('Hallo')
    expect(first.interim).toBe('wereld')
    expect(first.nextFinalIndex).toBe(1)

    const second = consumeSpeechResults(
      [
        { isFinal: true, transcript: 'Hallo' },
        { isFinal: true, transcript: ' wereld' },
      ],
      first.nextFinalIndex,
    )
    expect(second.finalChunk).toBe('wereld')
    expect(second.interim).toBe('')
    expect(second.nextFinalIndex).toBe(2)
  })
})
