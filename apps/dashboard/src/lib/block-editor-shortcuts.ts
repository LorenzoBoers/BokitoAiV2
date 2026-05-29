import type { DocBlockType } from './doc-api'

export interface MarkdownShortcutMatch {
  type: DocBlockType
  /** Characters to remove from the start of the current line (trigger only, not the space). */
  stripLength: number
  props?: Record<string, unknown>
}

/** Text from the start of the current line up to (but not including) the caret. */
export function linePrefixBeforeCaret(text: string, caret: number): string {
  const lineStart = text.lastIndexOf('\n', Math.max(0, caret - 1)) + 1
  return text.slice(lineStart, caret)
}

export function lineStartOffset(text: string, caret: number): number {
  return text.lastIndexOf('\n', Math.max(0, caret - 1)) + 1
}

/**
 * Match Notion/Markdown-style line prefixes typed before Space.
 * Examples: "- ", "* ", "1. ", "# ", "> ", "[ ] "
 */
export function matchMarkdownShortcut(linePrefix: string): MarkdownShortcutMatch | null {
  if (linePrefix === '-' || linePrefix === '*') {
    return { type: 'bullet_list_item', stripLength: linePrefix.length }
  }

  if (/^\d+\.$/.test(linePrefix)) {
    return { type: 'numbered_list_item', stripLength: linePrefix.length }
  }

  if (linePrefix === '#') return { type: 'heading_1', stripLength: 1 }
  if (linePrefix === '##') return { type: 'heading_2', stripLength: 2 }
  if (linePrefix === '###') return { type: 'heading_3', stripLength: 3 }

  if (linePrefix === '>') return { type: 'quote', stripLength: 1 }

  if (linePrefix === '[]' || linePrefix === '[ ]') {
    return { type: 'to_do', stripLength: linePrefix.length, props: { checked: false } }
  }
  if (linePrefix === '[x]' || linePrefix === '[X]') {
    return { type: 'to_do', stripLength: linePrefix.length, props: { checked: true } }
  }

  if (linePrefix === '---') return { type: 'divider', stripLength: 3 }

  return null
}

export function isListBlockType(type: DocBlockType): boolean {
  return type === 'bullet_list_item' || type === 'numbered_list_item' || type === 'to_do'
}

export interface InputShortcutResult {
  text: string
  type: DocBlockType
  props?: Record<string, unknown>
  caret: number
}

/**
 * Detect markdown shortcuts after the user types a trailing space on a line
 * (e.g. "- " or "1. "). More reliable than keydown alone for IME/paste/automation.
 */
export function tryApplyInputShortcut(
  text: string,
  currentType: DocBlockType,
): InputShortcutResult | null {
  if (currentType !== 'paragraph') return null
  if (!text.includes(' ')) return null

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.endsWith(' ')) continue
    const trigger = line.slice(0, -1)
    const match = matchMarkdownShortcut(trigger)
    if (!match || line !== `${trigger} `) continue

    lines[i] = ''
    let caret = 0
    for (let j = 0; j < i; j++) caret += lines[j].length + 1

    return {
      text: lines.join('\n'),
      type: match.type,
      props: match.props,
      caret,
    }
  }

  return null
}

/** 1-based index within a consecutive numbered-list run. */
export function numberedListIndex(
  blocks: { id: string; type: DocBlockType }[],
  blockId: string,
): number {
  const idx = blocks.findIndex((b) => b.id === blockId)
  if (idx === -1) return 1
  let count = 1
  for (let i = idx - 1; i >= 0; i--) {
    if (blocks[i].type === 'numbered_list_item') count++
    else break
  }
  return count
}
