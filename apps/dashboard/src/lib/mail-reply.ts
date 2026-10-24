/**
 * Mail-native reply intents: compute recipients, subject and quoted history
 * for Reply / Reply all / Forward started from an email bubble.
 *
 * The server (`POST /signals/{id}/reply`) receives the result as
 * `to`, `cc`, `mode`, `subject`, `quoted_html`, `source_message_id`.
 */

import { asMessageAttachments, type InboxMessage, type MessageAttachment } from './inbox-api'

export type MailDraftMode = 'reply' | 'reply_all' | 'forward'

/** Composer modes: the reply intents plus a brand-new outbound mail. */
export type MailComposerMode = MailDraftMode | 'new'

/** Intent the mail composer renders; `new` has no source message or quote. */
export type MailComposerIntent = Omit<MailDraftIntent, 'mode'> & { mode: MailComposerMode }

export type MailDraftIntent = {
  mode: MailDraftMode
  sourceMessageId: string
  /** Comma-separated To recipients (empty for forward). */
  to: string
  /** Comma-separated CC recipients. */
  cc: string
  subject: string
  /** Quoted source mail (header block + body) appended below the signature. */
  quotedHtml: string
  /** Short plain-text preview of the quoted mail for the collapsed state. */
  quotedPreview: string
  /**
   * Files that go out with this mail. Forward starts with the source mail's
   * file attachments (inline images stay in the quoted letter).
   */
  attachments?: MessageAttachment[]
}

/** Extract bare lowercase addresses from "Name <a@b>" / comma-separated / JSON-array headers. */
export function parseAddressList(raw: string | null | undefined): string[] {
  if (!raw) return []
  const trimmed = raw.trim()
  if (!trimmed) return []
  let source = trimmed
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (Array.isArray(parsed)) {
        source = parsed.map((item) => String(item).trim()).filter(Boolean).join(', ')
      }
    } catch {
      // Fall through to comma-separated parsing.
    }
  }
  const out: string[] = []
  for (const part of source.split(',')) {
    const match = part.match(/<([^<>\s]+@[^<>\s]+)>/) || part.match(/([^\s,;"<>]+@[^\s,;"<>]+)/)
    const addr = match?.[1]?.trim().toLowerCase()
    if (addr && !out.includes(addr)) out.push(addr)
  }
  return out
}

/** Human-readable recipient line (comma-separated; JSON arrays normalized). */
export function formatAddressListDisplay(raw: string | null | undefined): string {
  const parsed = parseAddressList(raw)
  if (parsed.length) return parsed.join(', ')
  const trimmed = (raw || '').trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('[')) {
    try {
      const parsedJson = JSON.parse(trimmed) as unknown
      if (Array.isArray(parsedJson)) {
        return parsedJson.map((item) => String(item).trim()).filter(Boolean).join(', ')
      }
    } catch {
      // keep raw
    }
  }
  return trimmed
}

export type RecipientFieldState = {
  /** Comma-separated value the composer stores (confirmed addresses, plus the text still being typed). */
  value: string
  /** When true, the text after the last comma is not a pill yet. */
  drafting: boolean
}

/** Confirmed entries and the unconfirmed tail of a recipient field. */
export function readRecipientField(
  raw: string | null | undefined,
  drafting: boolean,
): { chips: string[]; draft: string } {
  const source = raw || ''
  if (!drafting) {
    return {
      chips: source
        .split(/[,;\n]/)
        .map((part) => part.trim())
        .filter(Boolean),
      draft: '',
    }
  }
  const parts = source.split(/[,;\n]/)
  let draft = parts.pop() ?? ''
  // The stored form is "chips, draft"; drop only the separator space.
  if (draft.startsWith(' ')) draft = draft.slice(1)
  return {
    chips: parts.map((part) => part.trim()).filter(Boolean),
    draft,
  }
}

/** One token becomes the addresses inside it, or the raw text when it is not an address. */
function recipientPieces(token: string): string[] {
  const trimmed = token.trim()
  if (!trimmed) return []
  const parsed = parseAddressList(trimmed)
  if (parsed.length) return parsed
  return [trimmed]
}

function joinRecipientChips(tokens: string[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const token of tokens) {
    for (const piece of recipientPieces(token)) {
      const key = piece.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(piece)
    }
  }
  return out.join(', ')
}

function withRecipientDraft(chips: string[], draft: string): RecipientFieldState {
  const base = joinRecipientChips(chips)
  if (!draft) return { value: base, drafting: false }
  return { value: base ? `${base}, ${draft}` : draft, drafting: true }
}

/**
 * What the operator just typed in the recipient input (chips stay put).
 * Comma, semicolon, newline, or a trailing space after a bare address confirms a pill.
 */
export function applyRecipientTyping(chips: string[], typed: string): RecipientFieldState {
  if (!typed) return { value: joinRecipientChips(chips), drafting: false }
  if (/[,;\n]/.test(typed)) {
    const bits = typed.split(/[,;\n]/)
    const tail = bits.pop() ?? ''
    const committed = bits.flatMap(recipientPieces)
    const tailTrim = tail.trim()
    if (/[,;\n]\s*$/.test(typed) || !tailTrim) {
      return { value: joinRecipientChips([...chips, ...committed]), drafting: false }
    }
    return withRecipientDraft([...chips, ...committed], tailTrim)
  }
  if (/\s$/.test(typed)) {
    const trimmed = typed.trim()
    const parsed = parseAddressList(trimmed)
    if (parsed.length === 1 && parsed[0] === trimmed.toLowerCase()) {
      return { value: joinRecipientChips([...chips, parsed[0]]), drafting: false }
    }
  }
  return withRecipientDraft(chips, typed)
}

/** Enter, blur, or picking a contact confirms the text still in the input. */
export function commitRecipientDraft(chips: string[], draft: string): RecipientFieldState {
  return { value: joinRecipientChips([...chips, draft]), drafting: false }
}

/** Backspace on an empty input puts the last pill back in the field so it can be edited. */
export function editLastRecipient(chips: string[]): RecipientFieldState {
  if (!chips.length) return { value: '', drafting: false }
  const last = chips[chips.length - 1] ?? ''
  return withRecipientDraft(chips.slice(0, -1), last)
}

export function removeRecipientAt(
  chips: string[],
  index: number,
  draft: string,
  drafting: boolean,
): RecipientFieldState {
  const next = chips.filter((_, i) => i !== index)
  if (!drafting || !draft) return { value: joinRecipientChips(next), drafting: false }
  return withRecipientDraft(next, draft)
}

/**
 * A paste of one or more finished addresses confirms them as pills.
 * Returns null when the clipboard is still a fragment the input should take as typed text.
 */
export function applyRecipientPaste(chips: string[], text: string): RecipientFieldState | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (!/[,;\n]/.test(trimmed)) {
    const parsed = parseAddressList(trimmed)
    if (parsed.length === 1 && parsed[0] === trimmed.toLowerCase()) {
      return { value: joinRecipientChips([...chips, parsed[0]]), drafting: false }
    }
    return null
  }
  const bits = trimmed
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
  const tail = bits[bits.length - 1] ?? ''
  const tailParsed = parseAddressList(tail)
  const tailIsAddress = tailParsed.length === 1 && tailParsed[0] === tail.toLowerCase()
  if (tailIsAddress) return { value: joinRecipientChips([...chips, ...bits]), drafting: false }
  return withRecipientDraft([...chips, ...bits.slice(0, -1)], tail)
}

function excludeOwn(addresses: string[], ownAddresses: string[]): string[] {
  const own = new Set(ownAddresses.map((a) => a.trim().toLowerCase()).filter(Boolean))
  return addresses.filter((a) => !own.has(a))
}

const RE_PREFIX = /^(re|aw|antw)\s*:\s*/i
const FWD_PREFIX = /^(fwd?|doorst\.?)\s*:\s*/i

export function replySubject(subject: string): string {
  const base = (subject || '').trim()
  if (!base) return ''
  return RE_PREFIX.test(base) ? base : `Re: ${base}`
}

export function forwardSubject(subject: string): string {
  const base = (subject || '').trim().replace(RE_PREFIX, '')
  if (!base) return 'Fwd:'
  return FWD_PREFIX.test(base) ? base : `Fwd: ${base}`
}

/** File attachments on a mail, skipping images that already live in the HTML. */
export function mailFileAttachments(
  message: Pick<InboxMessage, 'attachments'>,
): MessageAttachment[] {
  return asMessageAttachments(message.attachments).filter((att) => !att.inline)
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const QUOTE_LABELS: Record<string, { from: string; sent: string; to: string; subject: string }> = {
  nl: { from: 'Van', sent: 'Verzonden', to: 'Aan', subject: 'Onderwerp' },
  en: { from: 'From', sent: 'Sent', to: 'To', subject: 'Subject' },
}

/** Outlook-style quoted block: separator + header lines + original body. */
export function buildQuotedHtml(
  message: Pick<
    InboxMessage,
    'fromAddress' | 'toHeader' | 'toAddresses' | 'subject' | 'bodyHtml' | 'bodyText' | 'receivedAt' | 'createdAt'
  >,
  opts: { language?: string | null; senderName?: string | null } = {},
): string {
  const lang = (opts.language || 'nl').slice(0, 2).toLowerCase()
  const labels = QUOTE_LABELS[lang] || QUOTE_LABELS.en
  const sentAt = message.receivedAt || message.createdAt
  const when = sentAt ? new Date(sentAt).toLocaleString(lang === 'nl' ? 'nl-NL' : 'en-GB') : ''
  const fromLine = opts.senderName
    ? `${opts.senderName} <${message.fromAddress}>`
    : message.fromAddress
  // Normalize JSON-array address fields (DB default "[]") so quotes never show "Aan: []".
  const toLine = formatAddressListDisplay(message.toHeader || message.toAddresses || '')
  const body =
    (message.bodyHtml || '').trim() ||
    `<div>${escapeHtml(message.bodyText || '').replace(/\n/g, '<br>')}</div>`
  const headerRows = [
    `<b>${labels.from}:</b> ${escapeHtml(fromLine)}`,
    when ? `<b>${labels.sent}:</b> ${escapeHtml(when)}` : '',
    toLine ? `<b>${labels.to}:</b> ${escapeHtml(toLine)}` : '',
    message.subject ? `<b>${labels.subject}:</b> ${escapeHtml(message.subject)}` : '',
  ].filter(Boolean)
  return (
    `<div class="bokito-quote">` +
    `<hr style="display:inline-block;width:98%" tabindex="-1">` +
    `<div dir="ltr" style="font-family:Calibri,sans-serif;font-size:11pt;color:#000">` + // design-system-ignore: email HTML, mail clients do not load app fonts
    headerRows.join('<br>') +
    `</div><br>` +
    body +
    `</div>`
  )
}

/** True when the source mail reached more people than just our mailbox. */
export function canReplyAll(
  message: Pick<InboxMessage, 'fromAddress' | 'toHeader' | 'cc'>,
  ownAddresses: string[],
): boolean {
  const others = excludeOwn(
    [...parseAddressList(message.toHeader), ...parseAddressList(message.cc)],
    ownAddresses,
  ).filter((a) => a !== (message.fromAddress || '').trim().toLowerCase())
  return others.length > 0
}

export function buildMailDraftIntent(
  message: InboxMessage,
  mode: MailDraftMode,
  opts: {
    /** Our connected mailbox address(es) — excluded from reply-all lists. */
    ownAddresses: string[]
    /** Thread contact fallback when the bubble has no From. */
    contactEmail?: string | null
    threadSubject?: string | null
    language?: string | null
    senderName?: string | null
  },
): MailDraftIntent {
  const isOutbound = message.direction === 'outbound'
  const from = (message.fromAddress || '').trim().toLowerCase()
  const subjectBase = message.subject || opts.threadSubject || ''

  let to: string[] = []
  let cc: string[] = []
  if (mode !== 'forward') {
    if (isOutbound) {
      // Replying on our own sent mail: keep its recipients.
      to = parseAddressList(message.toAddresses)
      if (!to.length && opts.contactEmail) to = parseAddressList(opts.contactEmail)
    } else {
      to = from ? [from] : parseAddressList(opts.contactEmail)
    }
    if (mode === 'reply_all') {
      const extraTo = excludeOwn(parseAddressList(message.toHeader), opts.ownAddresses).filter(
        (a) => !to.includes(a),
      )
      to = [...to, ...extraTo]
      cc = excludeOwn(parseAddressList(message.cc), opts.ownAddresses).filter(
        (a) => !to.includes(a),
      )
    }
  }

  const quotedHtml = buildQuotedHtml(message, {
    language: opts.language,
    senderName: opts.senderName,
  })
  const quotedPreview = (message.bodyText || message.bodyPreview || '').trim().slice(0, 160)

  return {
    mode,
    sourceMessageId: String(message.id),
    to: to.join(', '),
    cc: cc.join(', '),
    subject: mode === 'forward' ? forwardSubject(subjectBase) : replySubject(subjectBase),
    quotedHtml,
    quotedPreview,
    attachments: mode === 'forward' ? mailFileAttachments(message) : [],
  }
}
