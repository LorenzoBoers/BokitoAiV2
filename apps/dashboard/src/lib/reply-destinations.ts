import { isPlaceholderContactAddress } from './contact-label'

/** One way to reach the customer from the reply tab. */
export type ReplyDestination = {
  key: string
  /** ChannelGlyph kind: email, whatsapp, widget, slack, phone, … */
  channel: string
  label: string
  /** Open this conversation when it is a different thread. */
  threadId: string | null
  /** Send the current email thread to this address instead. */
  to: string | null
}

const PHONE_RE = /^\+?[\d\s().-]{8,}$/

export function looksLikePhone(value: string | null | undefined): boolean {
  const raw = (value ?? '').trim()
  if (!raw || raw.includes('@')) return false
  const digits = raw.replace(/\D/g, '')
  return digits.length >= 8 && PHONE_RE.test(raw)
}

export function glyphChannel(channel: string | null | undefined): string {
  const key = (channel ?? '').trim().toLowerCase()
  if (key === 'chat' || key === 'webchat' || key === 'livechat' || key === 'website' || key === 'widget') {
    return 'widget'
  }
  if (key === 'phone' || key === 'sms') return 'phone'
  return key || 'integration'
}

/** Address or number shown on the customer reply tab. */
export function customerReachLabel(input: {
  channel: string
  email?: string | null
  phone?: string | null
  name?: string | null
  fallback: string
}): string {
  const channel = glyphChannel(input.channel)
  const email = (input.email ?? '').trim()
  const phone = (input.phone ?? '').trim()
  const name = (input.name ?? '').trim()
  const realEmail = email.includes('@') && !isPlaceholderContactAddress(email) ? email : ''
  const realPhone = looksLikePhone(phone) ? phone : looksLikePhone(email) ? email : ''

  if (channel === 'email') return realEmail || name || input.fallback
  if (channel === 'whatsapp' || channel === 'phone') return realPhone || realEmail || name || input.fallback
  if (channel === 'slack') return name || realEmail || input.fallback
  return realEmail || realPhone || name || input.fallback
}

type ThreadLike = {
  id: string
  channel?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  contactName?: string | null
}

type IdentityLike = { channel: string; address: string }

function norm(value: string): string {
  return value.trim().toLowerCase()
}

function dedupeKey(channel: string, label: string): string {
  if (looksLikePhone(label)) return `tel:${label.replace(/\D/g, '')}`
  return `${glyphChannel(channel)}:${norm(label)}`
}

/**
 * Current conversation first, then other conversations and extra emails or
 * numbers on the same contact. A second email without its own thread stays
 * on this conversation (`to`). Anything we cannot deliver is omitted.
 */
export function buildReplyDestinations(input: {
  threadId: string
  channel: string
  email?: string | null
  phone?: string | null
  name?: string | null
  identities?: IdentityLike[]
  contactPhone?: string | null
  contactAddress?: string | null
  contactChannel?: string | null
  threads?: ThreadLike[]
  fallback: string
}): ReplyDestination[] {
  const currentChannel = glyphChannel(input.channel)
  const currentLabel = customerReachLabel({
    channel: input.channel,
    email: input.email,
    phone: input.phone,
    name: input.name,
    fallback: input.fallback,
  })
  const rows: ReplyDestination[] = [
    {
      key: `thread:${input.threadId}`,
      channel: currentChannel,
      label: currentLabel,
      threadId: input.threadId,
      to: null,
    },
  ]
  const seen = new Set<string>([dedupeKey(currentChannel, currentLabel)])

  const push = (channel: string, address: string, threadId: string | null, name?: string | null) => {
    const glyph = glyphChannel(channel)
    const trimmed = address.trim()
    const label = customerReachLabel({
      channel: glyph,
      email: trimmed.includes('@') ? trimmed : '',
      phone: looksLikePhone(trimmed) ? trimmed : '',
      name,
      fallback: trimmed && !isPlaceholderContactAddress(trimmed) ? trimmed : input.fallback,
    })
    if (!label.trim() || isPlaceholderContactAddress(label)) return
    const key = dedupeKey(glyph, label)
    if (seen.has(key)) return
    const otherThread = Boolean(threadId && threadId !== input.threadId)
    const alternateEmail =
      !otherThread &&
      glyph === 'email' &&
      currentChannel === 'email' &&
      trimmed.includes('@') &&
      !isPlaceholderContactAddress(trimmed) &&
      norm(trimmed) !== norm(input.email ?? '')
    const alternatePhone =
      !otherThread &&
      (glyph === 'phone' || glyph === 'whatsapp') &&
      looksLikePhone(trimmed) &&
      norm(trimmed) !== norm(input.phone ?? '') &&
      norm(trimmed) !== norm(currentLabel)
    if (!otherThread && !alternateEmail && !alternatePhone) return
    seen.add(key)
    rows.push({
      key: otherThread ? `thread:${threadId}` : `addr:${key}`,
      channel: glyph,
      label,
      threadId: otherThread ? threadId : null,
      to: alternateEmail || (alternatePhone && currentChannel === 'whatsapp') ? trimmed : null,
    })
  }

  for (const thread of input.threads ?? []) {
    if (thread.id === input.threadId) continue
    const channel = thread.channel || 'email'
    const address =
      (thread.contactPhone || '').trim() ||
      (thread.contactEmail || '').trim() ||
      (thread.contactName || '').trim()
    push(channel, address, thread.id, thread.contactName)
  }
  if (input.contactAddress) {
    push(input.contactChannel || 'email', input.contactAddress, null)
  }
  if (input.contactPhone) {
    const phoneChannel = glyphChannel(input.contactChannel) === 'whatsapp' ? 'whatsapp' : 'phone'
    push(phoneChannel, input.contactPhone, null)
  }
  for (const identity of input.identities ?? []) {
    push(identity.channel, identity.address, null)
  }
  return rows
}
