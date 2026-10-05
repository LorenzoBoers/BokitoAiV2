/**
 * Minimal chat formatting, as on WhatsApp: bold, italic, strike, inline code,
 * links, mentions and line breaks. Report markup the model may still emit
 * (headings, tables, rules) is flattened to plain lines.
 *
 * Tolerant: a marker without its partner stays literal in saved text; while
 * streaming, an opening marker at the tail styles the rest so a half-typed
 * `**bold` never flashes raw asterisks.
 */

export type ChatInline =
  | { type: 'text'; text: string }
  | { type: 'bold' | 'italic' | 'strike'; children: ChatInline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; label: string; href: string }
  | { type: 'mention'; name: string; kind: string }

export type ChatBlock =
  | { type: 'line'; inline: ChatInline[]; bold?: boolean; quote?: boolean }
  | { type: 'code'; text: string }
  | { type: 'gap' }

const TOKEN_RE = new RegExp(
  [
    String.raw`@\[[^\]]+\]\((?:user|agent|team):[^)\s]+\)`, // mention
    String.raw`\[[^\]]+\]\([^)\s]+\)`, // markdown link
    String.raw`https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]`, // bare url
    String.raw`\x60[^\x60\n]+\x60`, // inline code
    String.raw`\*\*[^*\n]+?\*\*`, // **bold**
    String.raw`~~[^~\n]+?~~`, // ~~strike~~
    String.raw`(?<![\w*])\*[^*\s](?:[^*\n]*[^*\s])?\*(?![\w*])`, // *bold* (WhatsApp) / *italic*
    String.raw`(?<![\w~])~[^~\s](?:[^~\n]*[^~\s])?~(?![\w~])`, // ~strike~
    String.raw`(?<![\w_])_[^_\s](?:[^_\n]*[^_\s])?_(?![\w_])`, // _italic_
  ].join('|'),
  'g',
)

const MENTION_RE = /^@\[([^\]]+)\]\((user|agent|team):[^)\s]+\)$/
const LINK_RE = /^\[([^\]]+)\]\(([^)\s]+)\)$/

/** Opening markers that, while streaming, style the unfinished tail. */
const OPEN_TAIL_RE = /(\*\*|~~|\x60|(?<![\w*])\*|(?<![\w_])_|(?<![\w~])~)(?=\S)([^\n]*)$/

function tokenToInline(token: string, streaming: boolean): ChatInline {
  const mention = token.match(MENTION_RE)
  if (mention) return { type: 'mention', name: mention[1], kind: mention[2] }
  const link = token.match(LINK_RE)
  if (link) return { type: 'link', label: link[1], href: link[2] }
  if (/^https?:\/\//.test(token)) return { type: 'link', label: token, href: token }
  if (token.startsWith('\x60')) return { type: 'code', text: token.slice(1, -1) }
  if (token.startsWith('**')) return { type: 'bold', children: parseChatInline(token.slice(2, -2), { streaming }) }
  if (token.startsWith('~~')) return { type: 'strike', children: parseChatInline(token.slice(2, -2), { streaming }) }
  const inner = parseChatInline(token.slice(1, -1), { streaming })
  // A single `*x*` is bold on WhatsApp; agents write it for emphasis.
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

export function parseChatInline(text: string, opts: { streaming?: boolean } = {}): ChatInline[] {
  const streaming = Boolean(opts.streaming)
  const out: ChatInline[] = []
  const re = new RegExp(TOKEN_RE.source, 'g')
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) out.push({ type: 'text', text: text.slice(last, match.index) })
    out.push(tokenToInline(match[0], streaming))
    last = match.index + match[0].length
  }
  if (last < text.length) out.push(...tailInline(text.slice(last), streaming))
  return out
}

function inlineToPlain(nodes: ChatInline[]): string {
  return nodes
    .map((n) => {
      if (n.type === 'text' || n.type === 'code') return n.text
      if (n.type === 'link') return n.label
      if (n.type === 'mention') return `@${n.name}`
      return inlineToPlain(n.children)
    })
    .join('')
}

/** Chat text without its markers, for one-line previews and excerpts. */
export function plainChatText(text: string): string {
  return text
    .split('\n')
    .map((line) => inlineToPlain(parseChatInline(line)))
    .join('\n')
}

const RULE_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/
const HEADING_RE = /^\s*#{1,6}\s+(.*)$/
const TABLE_SEP_RE = /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-*:?\s*$/
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/

export function parseChatText(text: string, opts: { streaming?: boolean } = {}): ChatBlock[] {
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
    i += 1
    if (RULE_RE.test(line) || TABLE_SEP_RE.test(line)) continue
    if (!line.trim()) {
      if (blocks.length && blocks[blocks.length - 1].type !== 'gap') blocks.push({ type: 'gap' })
      continue
    }
    const heading = line.match(HEADING_RE)
    if (heading) {
      blocks.push({ type: 'line', inline: parseChatInline(heading[1], opts), bold: true })
      continue
    }
    if (TABLE_ROW_RE.test(line)) {
      const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
      blocks.push({ type: 'line', inline: parseChatInline(cells.filter(Boolean).join(' · '), opts) })
      continue
    }
    const quote = line.match(/^\s*>\s?(.*)$/)
    if (quote) {
      blocks.push({ type: 'line', inline: parseChatInline(quote[1], opts), quote: true })
      continue
    }
    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/)
    const body = bullet ? `${bullet[1]}• ${bullet[2]}` : line
    blocks.push({ type: 'line', inline: parseChatInline(body, opts) })
  }
  while (blocks.length && blocks[blocks.length - 1].type === 'gap') blocks.pop()
  return blocks
}
