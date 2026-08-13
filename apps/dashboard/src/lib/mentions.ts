/** Inline mention markup shared with the API: `@[Name](user:123)` / `@[Name](agent:uuid)`. */

export type MentionTargetType = 'user' | 'agent'

export type MentionItem = {
  type: MentionTargetType
  /** Numeric user id or agent uuid, as used in the markup. */
  id: string
  name: string
  email?: string
  avatarUrl?: string | null
}

export const MENTION_MARKUP_PATTERN = /@\[([^\]]+)\]\((user|agent):([^)]+)\)/g

export function mentionMarkup(item: MentionItem): string {
  return `@[${item.name}](${item.type}:${item.id})`
}

/** Replace mention markup with plain `@Name` (for previews, toasts, copy). */
export function stripMentionMarkup(text: string): string {
  return text.replace(MENTION_MARKUP_PATTERN, (_, name) => `@${name}`)
}

export type MentionToken =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; name: string; targetType: MentionTargetType; id: string }

/** Tokenize a message body so UIs can render mention chips inline. */
export function tokenizeMentions(text: string): MentionToken[] {
  const tokens: MentionToken[] = []
  let last = 0
  for (const match of text.matchAll(MENTION_MARKUP_PATTERN)) {
    const index = match.index ?? 0
    if (index > last) tokens.push({ kind: 'text', text: text.slice(last, index) })
    tokens.push({
      kind: 'mention',
      name: match[1],
      targetType: match[2] as MentionTargetType,
      id: match[3],
    })
    last = index + match[0].length
  }
  if (last < text.length) tokens.push({ kind: 'text', text: text.slice(last) })
  return tokens
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Replace mention markup with a styled chip span for HTML render paths.
 * Pair with the `.mention-chip` class in index.css.
 */
export function mentionMarkupToHtmlChips(html: string): string {
  const pattern = new RegExp(MENTION_MARKUP_PATTERN.source, 'g')
  return html.replace(pattern, (_, name: string, type: string) =>
    `<span class="mention-chip" data-mention-type="${type}">@${escapeHtml(name)}</span>`,
  )
}

export type MentionQuery = {
  /** Start index of the `@` character in the input value. */
  start: number
  /** The query text typed after `@` (may be empty). */
  query: string
}

/**
 * Detect an active mention being typed before the caret.
 * Active means: an `@` at a word boundary, with no whitespace/newline between
 * it and the caret, and not already completed markup.
 */
export function activeMentionQuery(value: string, caret: number): MentionQuery | null {
  const upToCaret = value.slice(0, caret)
  const at = upToCaret.lastIndexOf('@')
  if (at === -1) return null
  if (at > 0 && !/[\s([{]/.test(upToCaret[at - 1])) return null
  const query = upToCaret.slice(at + 1)
  if (/[\s\n]/.test(query)) return null
  if (query.startsWith('[')) return null // already markup
  if (query.length > 40) return null
  return { start: at, query }
}

/** Insert a selected mention, replacing the typed `@query`. Returns new value + caret. */
export function applyMention(
  value: string,
  caret: number,
  query: MentionQuery,
  item: MentionItem,
): { value: string; caret: number } {
  const markup = `${mentionMarkup(item)} `
  const next = value.slice(0, query.start) + markup + value.slice(caret)
  return { value: next, caret: query.start + markup.length }
}

export function filterMentionItems(items: MentionItem[], query: string): MentionItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items.slice(0, 8)
  return items
    .filter(
      (item) =>
        item.name.toLowerCase().includes(q) || (item.email ?? '').toLowerCase().includes(q),
    )
    .slice(0, 8)
}
