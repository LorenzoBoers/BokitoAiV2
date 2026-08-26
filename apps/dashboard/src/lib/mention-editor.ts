/**
 * Display-text editing model for mention markup in plain textareas.
 *
 * The stored ("raw") value keeps the API markup `@[Name](type:id)`. The
 * textarea shows the display value where each mention reads `@Name`, and a
 * highlighter layer behind the textarea draws pill styling. This module maps
 * between the two coordinate spaces and applies user edits made in display
 * space back onto the raw value, treating mentions as atomic tokens: any edit
 * that touches a mention removes the whole mention (like Slack/Notion pills).
 */

import { MENTION_MARKUP_PATTERN, mentionMarkup, type MentionItem, type MentionQuery, type MentionTargetType } from './mentions'

export type MentionSegment = {
  kind: 'text' | 'mention'
  rawStart: number
  rawEnd: number
  displayStart: number
  displayEnd: number
  /** Text as shown in the textarea (`@Name` for mentions). */
  display: string
  targetType?: MentionTargetType
  id?: string
}

export function mentionSegments(raw: string): MentionSegment[] {
  const segments: MentionSegment[] = []
  let rawLast = 0
  let displayLast = 0
  const push = (seg: MentionSegment) => {
    segments.push(seg)
    rawLast = seg.rawEnd
    displayLast = seg.displayEnd
  }
  for (const match of raw.matchAll(MENTION_MARKUP_PATTERN)) {
    const index = match.index ?? 0
    if (index > rawLast) {
      const text = raw.slice(rawLast, index)
      push({
        kind: 'text',
        rawStart: rawLast,
        rawEnd: index,
        displayStart: displayLast,
        displayEnd: displayLast + text.length,
        display: text,
      })
    }
    const display = `@${match[1]}`
    push({
      kind: 'mention',
      rawStart: index,
      rawEnd: index + match[0].length,
      displayStart: displayLast,
      displayEnd: displayLast + display.length,
      display,
      targetType: match[2] as MentionTargetType,
      id: match[3],
    })
  }
  if (rawLast < raw.length) {
    const text = raw.slice(rawLast)
    push({
      kind: 'text',
      rawStart: rawLast,
      rawEnd: raw.length,
      displayStart: displayLast,
      displayEnd: displayLast + text.length,
      display: text,
    })
  }
  return segments
}

export function displayFromRaw(raw: string): string {
  return mentionSegments(raw)
    .map((seg) => seg.display)
    .join('')
}

/**
 * Map a display offset to a raw offset. Offsets on a mention boundary map to
 * the matching raw boundary; offsets inside a mention snap according to
 * `bias` (used for the edges of an edit region after atomic expansion).
 */
export function displayOffsetToRaw(
  segments: MentionSegment[],
  displayOffset: number,
  bias: 'start' | 'end',
): number {
  if (segments.length === 0) return 0
  for (const seg of segments) {
    if (displayOffset > seg.displayEnd) continue
    if (seg.kind === 'text') return seg.rawStart + (displayOffset - seg.displayStart)
    if (displayOffset === seg.displayStart) return seg.rawStart
    if (displayOffset === seg.displayEnd) return seg.rawEnd
    return bias === 'start' ? seg.rawStart : seg.rawEnd
  }
  return segments[segments.length - 1].rawEnd
}

export type DisplayEditResult = {
  raw: string
  /** Caret position in the *new* display text after the edit. */
  displayCaret: number
  /** New display text (derived from `raw`; may differ from the textarea's). */
  display: string
}

/**
 * Apply an edit the user made in display space back onto the raw value.
 * Uses a prefix/suffix diff between the old and new display text, then
 * expands the changed region over any mention it touches so mentions are
 * deleted whole instead of degrading into broken markup.
 */
export function applyDisplayEdit(raw: string, newDisplay: string): DisplayEditResult {
  const segments = mentionSegments(raw)
  const oldDisplay = segments.map((seg) => seg.display).join('')
  if (newDisplay === oldDisplay) {
    return { raw, displayCaret: newDisplay.length, display: newDisplay }
  }

  let prefix = 0
  const maxPrefix = Math.min(oldDisplay.length, newDisplay.length)
  while (prefix < maxPrefix && oldDisplay[prefix] === newDisplay[prefix]) prefix += 1
  let suffix = 0
  const maxSuffix = Math.min(oldDisplay.length - prefix, newDisplay.length - prefix)
  while (
    suffix < maxSuffix &&
    oldDisplay[oldDisplay.length - 1 - suffix] === newDisplay[newDisplay.length - 1 - suffix]
  ) {
    suffix += 1
  }

  let editStart = prefix
  let editEnd = oldDisplay.length - suffix
  const inserted = newDisplay.slice(prefix, newDisplay.length - suffix)

  for (const seg of segments) {
    if (seg.kind !== 'mention') continue
    const overlaps = seg.displayStart < editEnd && seg.displayEnd > editStart
    const caretInside =
      editStart === editEnd && seg.displayStart < editStart && editStart < seg.displayEnd
    if (overlaps || caretInside) {
      editStart = Math.min(editStart, seg.displayStart)
      editEnd = Math.max(editEnd, seg.displayEnd)
    }
  }

  const rawStart = displayOffsetToRaw(segments, editStart, 'start')
  const rawEnd = displayOffsetToRaw(segments, editEnd, 'end')
  const nextRaw = raw.slice(0, rawStart) + inserted + raw.slice(rawEnd)
  return {
    raw: nextRaw,
    displayCaret: editStart + inserted.length,
    display: displayFromRaw(nextRaw),
  }
}

/**
 * Insert a picked mention, replacing the typed `@query` (display coordinates).
 * Returns the new raw value plus the caret in the new display text.
 */
export function applyMentionAtDisplay(
  raw: string,
  displayCaret: number,
  query: MentionQuery,
  item: MentionItem,
): { raw: string; displayCaret: number } {
  const segments = mentionSegments(raw)
  const rawStart = displayOffsetToRaw(segments, query.start, 'start')
  const rawCaret = displayOffsetToRaw(segments, displayCaret, 'end')
  const markup = `${mentionMarkup(item)} `
  const nextRaw = raw.slice(0, rawStart) + markup + raw.slice(rawCaret)
  return { raw: nextRaw, displayCaret: query.start + `@${item.name} `.length }
}
