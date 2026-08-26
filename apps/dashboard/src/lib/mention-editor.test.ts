import { describe, expect, it } from 'vitest'
import {
  applyDisplayEdit,
  applyMentionAtDisplay,
  displayFromRaw,
  displayOffsetToRaw,
  mentionSegments,
} from './mention-editor'
import type { MentionItem, MentionQuery } from './mentions'

const AGENT_RAW = '@[Assistant](agent:a4c6eb92-2175-41c1-afde-5fda9badcb34)'
const AGENT_DISPLAY = '@Assistant'

describe('displayFromRaw', () => {
  it('shows @Name for mention markup', () => {
    expect(displayFromRaw(`Hoi ${AGENT_RAW} kijk even mee`)).toBe(
      `Hoi ${AGENT_DISPLAY} kijk even mee`,
    )
  })

  it('passes plain text through', () => {
    expect(displayFromRaw('gewoon tekst')).toBe('gewoon tekst')
  })

  it('handles multiple mentions', () => {
    const raw = `${AGENT_RAW} en @[Bob](user:7) samen`
    expect(displayFromRaw(raw)).toBe('@Assistant en @Bob samen')
  })
})

describe('mentionSegments / displayOffsetToRaw', () => {
  it('maps offsets in text segments linearly', () => {
    const raw = `Hoi ${AGENT_RAW}!`
    const segments = mentionSegments(raw)
    expect(displayOffsetToRaw(segments, 0, 'start')).toBe(0)
    expect(displayOffsetToRaw(segments, 4, 'start')).toBe(4)
    // Offset right after "@Assistant" maps to right after the markup.
    expect(displayOffsetToRaw(segments, 4 + AGENT_DISPLAY.length, 'end')).toBe(4 + AGENT_RAW.length)
  })

  it('snaps offsets inside a mention to its raw boundaries', () => {
    const segments = mentionSegments(AGENT_RAW)
    expect(displayOffsetToRaw(segments, 3, 'start')).toBe(0)
    expect(displayOffsetToRaw(segments, 3, 'end')).toBe(AGENT_RAW.length)
  })
})

describe('applyDisplayEdit', () => {
  it('applies plain typing outside mentions', () => {
    const raw = `Hoi ${AGENT_RAW} `
    const display = displayFromRaw(raw)
    const result = applyDisplayEdit(raw, `${display}dag`)
    expect(result.raw).toBe(`${raw}dag`)
    expect(result.display).toBe(`${display}dag`)
    expect(result.displayCaret).toBe(`${display}dag`.length)
  })

  it('typing before a mention keeps the mention intact', () => {
    const raw = `${AGENT_RAW} hallo`
    const result = applyDisplayEdit(raw, `x${AGENT_DISPLAY} hallo`)
    expect(result.raw).toBe(`x${AGENT_RAW} hallo`)
    expect(result.displayCaret).toBe(1)
  })

  it('backspace at the end of a pill removes the whole mention', () => {
    const raw = `Hoi ${AGENT_RAW} daar`
    // Browser deleted the trailing "t" of "@Assistant".
    const result = applyDisplayEdit(raw, 'Hoi @Assistan daar')
    expect(result.raw).toBe('Hoi  daar')
    expect(result.display).toBe('Hoi  daar')
    expect(result.displayCaret).toBe(4)
  })

  it('typing inside a pill replaces the whole mention with the typed text', () => {
    const raw = AGENT_RAW
    // Browser inserted "x" in the middle of "@Assistant".
    const result = applyDisplayEdit(raw, '@Assixstant')
    expect(result.raw).toBe('x')
    expect(result.displayCaret).toBe(1)
  })

  it('selection replace spanning a mention removes it whole', () => {
    const raw = `abc ${AGENT_RAW} def`
    // User selected "c @Assistant d" and typed "X".
    const result = applyDisplayEdit(raw, 'abXef')
    expect(result.raw).toBe('abXef')
    expect(result.displayCaret).toBe(3)
  })

  it('deleting text next to a pill does not eat the pill', () => {
    const raw = `${AGENT_RAW} x`
    const result = applyDisplayEdit(raw, `${AGENT_DISPLAY} `)
    expect(result.raw).toBe(`${AGENT_RAW} `)
  })

  it('keeps sibling mentions intact when one is removed', () => {
    const raw = `${AGENT_RAW} en @[Bob](user:7)`
    // Backspace on the Bob pill's last character.
    const result = applyDisplayEdit(raw, `${AGENT_DISPLAY} en @Bo`)
    expect(result.raw).toBe(`${AGENT_RAW} en `)
  })

  it('returns unchanged input when nothing changed', () => {
    const raw = `Hoi ${AGENT_RAW}`
    const display = displayFromRaw(raw)
    const result = applyDisplayEdit(raw, display)
    expect(result.raw).toBe(raw)
    expect(result.display).toBe(display)
  })
})

describe('applyMentionAtDisplay', () => {
  const item: MentionItem = {
    type: 'agent',
    id: 'a4c6eb92-2175-41c1-afde-5fda9badcb34',
    name: 'Assistant',
  }

  it('replaces the typed @query with markup and returns the display caret', () => {
    const raw = 'Hoi @Assi'
    const query: MentionQuery = { start: 4, query: 'Assi' }
    const result = applyMentionAtDisplay(raw, raw.length, query, item)
    expect(result.raw).toBe(`Hoi ${AGENT_RAW} `)
    expect(result.displayCaret).toBe('Hoi @Assistant '.length)
  })

  it('works when an earlier mention already exists', () => {
    const raw = `${AGENT_RAW} cc @Bo`
    const display = displayFromRaw(raw)
    const query: MentionQuery = { start: display.indexOf('@Bo'), query: 'Bo' }
    const bob: MentionItem = { type: 'user', id: '7', name: 'Bob' }
    const result = applyMentionAtDisplay(raw, display.length, query, bob)
    expect(result.raw).toBe(`${AGENT_RAW} cc @[Bob](user:7) `)
    expect(result.displayCaret).toBe('@Assistant cc @Bob '.length)
  })
})
