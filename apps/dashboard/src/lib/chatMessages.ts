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
  for (const block of blocks(text || '')) {
    if (merged.length && block.length < MIN_MESSAGE_CHARS) {
      merged[merged.length - 1] = `${merged[merged.length - 1]}\n${block}`
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
