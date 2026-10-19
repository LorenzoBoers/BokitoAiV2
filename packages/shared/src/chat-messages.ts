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
const LIST_MARKER_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+/
const HEARTBEAT_PREFIX_RE = /^\s*HEARTBEAT_OK\b\s*[—–\-:]?\s*/i

function stripHeartbeat(block: string): string {
  return block.replace(HEARTBEAT_PREFIX_RE, '').trim()
}

/** Blocks without a letter or digit (a lone `---` rule, `**`) are dropped. */
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

/** One paragraph per bubble. A markdown list becomes separate sentences. */
function paragraphs(block: string): string[] {
  if (block.trimStart().startsWith('```')) return [block]
  const prose: string[] = []
  const out: string[] = []
  const flush = () => {
    const text = prose.map((part) => part.trim()).filter(Boolean).join(' ')
    prose.length = 0
    if (text) out.push(text)
  }
  for (const line of block.split('\n')) {
    if (LIST_LINE_RE.test(line.trim())) {
      flush()
      const item = line.replace(LIST_MARKER_RE, '').trim()
      if (item) out.push(item)
      continue
    }
    prose.push(line)
  }
  flush()
  return out
}

/** Blank line = new message. One paragraph per bubble; code stays whole. */
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
    // Short opener + restart after a blank line ("Je" / "Je dashboard…") —
    // one bubble, not a stutter. Other short openers join forward.
    if (prev && prev.length < MIN_MESSAGE_CHARS) {
      merged[merged.length - 1] = block.startsWith(prev) ? block : `${prev}\n${block}`
      continue
    }
    merged.push(...paragraphs(block))
  }
  if (maxMessages > 0 && merged.length > maxMessages) {
    const head = merged.slice(0, maxMessages - 1)
    const tail = merged.slice(maxMessages - 1).join(' ')
    return [...head, tail]
  }
  return merged
}
