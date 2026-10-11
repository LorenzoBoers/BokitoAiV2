/**
 * Minimal chat formatting, as on WhatsApp: bold, italic, strike, inline code,
 * links, mentions, tags, status pills and line breaks. Report markup the model
 * may still emit (headings, tables, rules) is flattened to plain lines.
 *
 * Tolerant: a marker without its partner stays literal in saved text; while
 * streaming, an opening marker at the tail styles the rest so a half-typed
 * `**bold` never flashes raw asterisks.
 */

export type ChatTagKind = 'tag' | 'action_tag'

export type ChatInline =
  | { type: 'text'; text: string }
  | { type: 'bold' | 'italic' | 'strike'; children: ChatInline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; label: string; href: string }
  | { type: 'mention'; name: string; kind: string; id?: string }
  | { type: 'tag'; name: string; kind: ChatTagKind; id?: string }
  | { type: 'status'; label: string; key: string }

export type ChatBlock =
  | { type: 'line'; inline: ChatInline[]; bold?: boolean; quote?: boolean }
  /** Consecutive bullet / numbered lines, rendered as one calm list. */
  | { type: 'list'; ordered: boolean; items: ChatInline[][] }
  | { type: 'code'; text: string }
  | { type: 'gap' }

/** Optional map of lowercase tag name -> kind for bare #name resolution. */
export type ChatTagMap = Record<string, ChatTagKind>

const TOKEN_RE = new RegExp(
  [
    String.raw`\[@\[[^\]]+\]\((?:user|agent|team):[^)\s]+\)\]`, // bracket-wrapped mention
    String.raw`@\[[^\]]+\]\((?:user|agent|team):[^)\s]+\)`, // mention
    String.raw`#\[\[[^\]]+\]\]\((?:tag|action_tag):[^)\s]+\)`, // structured tag
    String.raw`\[[^\]]+\]\(status:[^)\s]+\)`, // status pill
    String.raw`\[[^\]]+\]\([^)\s]+\)`, // markdown link
    String.raw`https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]`, // bare url
    String.raw`#[\p{L}\p{N}_-]{1,64}`, // bare #tag
    String.raw`\x60[^\x60\n]+\x60`, // inline code
    String.raw`\*\*[^*\n]+?\*\*`, // **bold**
    String.raw`~~[^~\n]+?~~`, // ~~strike~~
    String.raw`(?<![\w*])\*[^*\s](?:[^*\n]*[^*\s])?\*(?![\w*])`, // *bold*
    String.raw`(?<![\w~])~[^~\s](?:[^~\n]*[^~\s])?~(?![\w~])`, // ~strike~
    String.raw`(?<![\w_])_[^_\s](?:[^_\n]*[^_\s])?_(?![\w_])`, // _italic_
  ].join('|'),
  'gu',
)

const MENTION_RE = /^\[?@\[([^\]]+)\]\((user|agent|team):([^)\s]+)\)\]?$/
const STRUCT_TAG_RE = /^#\[\[([^\]]+)\]\]\((tag|action_tag):([^)\s]+)\)$/
const STATUS_RE = /^\[([^\]]+)\]\(status:([^)\s]+)\)$/
const LINK_RE = /^\[([^\]]+)\]\(([^)\s]+)\)$/
const BARE_TAG_RE = /^#([\p{L}\p{N}_-]{1,64})$/u

/** Opening markers that, while streaming, style the unfinished tail. */
const OPEN_TAIL_RE = /(\*\*|~~|\x60|(?<![\w*])\*|(?<![\w_])_|(?<![\w~])~)(?=\S)([^\n]*)$/

function tokenToInline(token: string, streaming: boolean, tags?: ChatTagMap): ChatInline {
  const mention = token.match(MENTION_RE)
  if (mention) return { type: 'mention', name: mention[1], kind: mention[2], id: mention[3] }
  const structTag = token.match(STRUCT_TAG_RE)
  if (structTag) {
    return {
      type: 'tag',
      name: structTag[1].replace(/^#/, ''),
      kind: structTag[2] as ChatTagKind,
      id: structTag[3],
    }
  }
  const status = token.match(STATUS_RE)
  if (status) return { type: 'status', label: status[1], key: status[2].toLowerCase() }
  const link = token.match(LINK_RE)
  if (link) return { type: 'link', label: link[1], href: link[2] }
  if (/^https?:\/\//.test(token)) return { type: 'link', label: token, href: token }
  const bareTag = token.match(BARE_TAG_RE)
  if (bareTag) {
    const name = bareTag[1]
    const kind = tags?.[name.toLowerCase()] ?? 'tag'
    return { type: 'tag', name, kind }
  }
  if (token.startsWith('\x60')) return { type: 'code', text: token.slice(1, -1) }
  if (token.startsWith('**')) return { type: 'bold', children: parseChatInline(token.slice(2, -2), { streaming, tags }) }
  if (token.startsWith('~~')) return { type: 'strike', children: parseChatInline(token.slice(2, -2), { streaming, tags }) }
  const inner = parseChatInline(token.slice(1, -1), { streaming, tags })
  if (token.startsWith('*')) return { type: 'bold', children: inner }
  if (token.startsWith('~')) return { type: 'strike', children: inner }
  return { type: 'italic', children: inner }
}

function tailInline(text: string, streaming: boolean): ChatInline[] {
  if (!streaming) return [{ type: 'text', text }]
  const open = text.match(OPEN_TAIL_RE)
  if (!open || open.index === undefined) return [{ type: 'text', text }]
  const before = text.slice(0, open.index)
  const marker = open[1]
  const rest = open[2]
  const out: ChatInline[] = before ? [{ type: 'text', text: before }] : []
  if (marker === '\x60') out.push({ type: 'code', text: rest })
  else if (marker === '**' || marker === '*') out.push({ type: 'bold', children: [{ type: 'text', text: rest }] })
  else if (marker === '~~' || marker === '~') out.push({ type: 'strike', children: [{ type: 'text', text: rest }] })
  else out.push({ type: 'italic', children: [{ type: 'text', text: rest }] })
  return out
}

export function parseChatInline(
  text: string,
  opts: { streaming?: boolean; tags?: ChatTagMap } = {},
): ChatInline[] {
  const streaming = Boolean(opts.streaming)
  const out: ChatInline[] = []
  const re = new RegExp(TOKEN_RE.source, 'gu')
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) out.push({ type: 'text', text: text.slice(last, match.index) })
    out.push(tokenToInline(match[0], streaming, opts.tags))
    last = match.index + match[0].length
  }
  if (last < text.length) out.push(...tailInline(text.slice(last), streaming))
  return out
}

function inlineToPlain(nodes: ChatInline[]): string {
  return nodes
    .map((n) => {
      if (n.type === 'text' || n.type === 'code') return n.text
      if (n.type === 'link' || n.type === 'status') return n.label
      if (n.type === 'mention') return `@${n.name}`
      if (n.type === 'tag') return `#${n.name}`
      return inlineToPlain(n.children)
    })
    .join('')
}

/** Chat text without its markers, for one-line previews and excerpts. */
export function plainChatText(text: string, tags?: ChatTagMap): string {
  return text
    .split('\n')
    .map((line) => inlineToPlain(parseChatInline(line, { tags })))
    .join('\n')
}

const RULE_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/
const HEADING_RE = /^\s*#{1,6}\s+(.*)$/
const TABLE_SEP_RE = /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-*:?\s*$/
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/
const BULLET_RE = /^\s*[-*+]\s+(.*)$/
const ORDERED_RE = /^\s*\d+[.)]\s+(.*)$/

/** Peel a leading #tag (+ optional dash/colon) so lists can align tag | description. */
export function splitTagLedInline(inline: ChatInline[]): {
  tag: Extract<ChatInline, { type: 'tag' }> | null
  rest: ChatInline[]
} {
  let i = 0
  while (i < inline.length) {
    const node = inline[i]
    if (node.type === 'text' && !node.text.trim()) {
      i += 1
      continue
    }
    break
  }
  const first = inline[i]
  if (!first || first.type !== 'tag') return { tag: null, rest: inline }
  const rest = inline.slice(i + 1).map((node, index) => {
    if (index !== 0 || node.type !== 'text') return node
    return { type: 'text' as const, text: node.text.replace(/^\s*[–—\-:]\s*/, '') }
  })
  while (rest.length) {
    const head = rest[0]
    if (head.type === 'text' && !head.text.trim()) {
      rest.shift()
      continue
    }
    break
  }
  return { tag: first, rest }
}

export function parseChatText(
  text: string,
  opts: { streaming?: boolean; tags?: ChatTagMap } = {},
): ChatBlock[] {
  const blocks: ChatBlock[] = []
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      const code: string[] = []
      i += 1
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        code.push(lines[i])
        i += 1
      }
      i += 1
      blocks.push({ type: 'code', text: code.join('\n') })
      continue
    }
    if (RULE_RE.test(line) || TABLE_SEP_RE.test(line)) {
      i += 1
      continue
    }
    if (!line.trim()) {
      if (blocks.length && blocks[blocks.length - 1].type !== 'gap') blocks.push({ type: 'gap' })
      i += 1
      continue
    }
    const heading = line.match(HEADING_RE)
    if (heading) {
      blocks.push({ type: 'line', inline: parseChatInline(heading[1], opts), bold: true })
      i += 1
      continue
    }
    if (TABLE_ROW_RE.test(line)) {
      const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
      blocks.push({ type: 'line', inline: parseChatInline(cells.filter(Boolean).join(' · '), opts) })
      i += 1
      continue
    }
    const quote = line.match(/^\s*>\s?(.*)$/)
    if (quote) {
      blocks.push({ type: 'line', inline: parseChatInline(quote[1], opts), quote: true })
      i += 1
      continue
    }
    const bullet = line.match(BULLET_RE)
    const ordered = line.match(ORDERED_RE)
    if (bullet || ordered) {
      const isOrdered = Boolean(ordered)
      const items: ChatInline[][] = []
      while (i < lines.length) {
        const row = lines[i]
        const b = row.match(BULLET_RE)
        const o = row.match(ORDERED_RE)
        if (isOrdered ? !o : !b) break
        items.push(parseChatInline((isOrdered ? o![1] : b![1]) ?? '', opts))
        i += 1
      }
      blocks.push({ type: 'list', ordered: isOrdered, items })
      continue
    }
    blocks.push({ type: 'line', inline: parseChatInline(line, opts) })
    i += 1
  }
  while (blocks.length && blocks[blocks.length - 1].type === 'gap') blocks.pop()
  return blocks
}

/** Icon hint for app-path link pills. */
export type AppLinkKind =
  | 'docs'
  | 'connections'
  | 'settings'
  | 'project'
  | 'flow'
  | 'inbox'
  | 'contact'
  | 'agent'
  | 'other'

export function appLinkKind(href: string): AppLinkKind {
  if (href.startsWith('/docs') || href.startsWith('/learn')) return 'docs'
  if (href.startsWith('/connections') || href.startsWith('/integrations')) return 'connections'
  if (href.startsWith('/settings')) return 'settings'
  if (href.startsWith('/projects')) return 'project'
  if (href.startsWith('/workstreams') || href.startsWith('/flows')) return 'flow'
  // Conversations: hub paths and the short /threads/{id} form agents sometimes emit.
  if (
    href.startsWith('/communication') ||
    href.startsWith('/inbox') ||
    href.startsWith('/threads/')
  ) {
    return 'inbox'
  }
  // Person page; companies stay "other" (folder icon would be wrong).
  if (/^\/contacts\/(?!companies(?:\/|$))[^/]+/.test(href)) return 'contact'
  if (/^\/agents\/[^/]+/.test(href)) return 'agent'
  return 'other'
}
