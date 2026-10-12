/**
 * Chat-mode bubble splitting. Mirror of `split_chat_messages` in
 * `apps/api/app/services/agent/reply_mode.py`; keep both in sync so the live
 * stream and the saved messages show the same bubbles.
 */

export const MAX_CHAT_MESSAGES = 5
export const MIN_MESSAGE_CHARS = 3

/** Channels where nothing reaches a customer (mirror of `INTERNAL_CHANNELS`). */
const INTERNAL_CHANNELS = new Set(['assistant', 'internal', 'team'])

/** True when an agent reply on this channel is meant for a customer. */
export function isCustomerChannel(channel: string | null | undefined): boolean {
  return Boolean(channel) && !INTERNAL_CHANNELS.has(String(channel))
}

const FENCE_RE = /^\s*```/
const VISIBLE_RE = /[\p{L}\p{N}]/u
const LIST_LINE_RE = /^(?:[-*+]|\d+[.)])\s+\S/
const HEARTBEAT_PREFIX_RE = /^\s*HEARTBEAT_OK\b\s*[—–\-:]?\s*/i

function stripHeartbeat(block: string): string {
  return block.replace(HEARTBEAT_PREFIX_RE, '').trim()
}

function isListBlock(block: string): boolean {
  let lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
  while (
    lines.length &&
    !LIST_LINE_RE.test(lines[0]) &&
    (lines[0].startsWith('#') || (lines[0].endsWith(':') && lines[0].length <= 80))
  ) {
    lines = lines.slice(1)
  }
  return lines.length > 0 && lines.every((line) => LIST_LINE_RE.test(line))
}

function isListLead(block: string): boolean {
  const text = block.trim()
  if (!text || text.includes('\n') || text.startsWith('```')) return false
  if (text.startsWith('#') && text.length <= 80) return true
  return text.endsWith(':') && text.length <= 80
}

/** Blocks without a letter or digit (a lone `---` rule, `**`) are dropped: alone they render as an empty bubble. */
function blocks(text: string): string[] {
  const out: string[] = []
  let current: string[] = []
  let inFence = false
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence
      current.push(line)
      continue
    }
    if (!inFence && !line.trim()) {
      if (current.length) {
        out.push(current.join('\n').trim())
        current = []
      }
      continue
    }
    current.push(line)
  }
  if (current.length) out.push(current.join('\n').trim())
  return out.filter((block) => VISIBLE_RE.test(block))
}

/** Blank line = new message (as on WhatsApp). Lists and code stay together. */
export function splitChatMessages(text: string, maxMessages = MAX_CHAT_MESSAGES): string[] {
  const merged: string[] = []
  for (const raw of blocks(text || '')) {
    const block = stripHeartbeat(raw)
    if (!block || !VISIBLE_RE.test(block)) continue
    if (merged.length && block.length < MIN_MESSAGE_CHARS) {
      merged[merged.length - 1] = `${merged[merged.length - 1]}\n${block}`
      continue
    }
    const prev = merged[merged.length - 1]
    if (prev && isListBlock(block) && (isListBlock(prev) || isListLead(prev))) {
      merged[merged.length - 1] = `${prev}\n${block}`
      continue
    }
    merged.push(block)
  }
  if (maxMessages > 0 && merged.length > maxMessages) {
    const head = merged.slice(0, maxMessages - 1)
    const tail = merged.slice(maxMessages - 1).join('\n\n')
    return [...head, tail]
  }
  return merged
}
