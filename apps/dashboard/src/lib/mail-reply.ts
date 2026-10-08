/**
 * Mail-native reply intents: compute recipients, subject and quoted history
 * for Reply / Reply all / Forward started from an email bubble.
 *
 * The server (`POST /signals/{id}/reply`) receives the result as
 * `to`, `cc`, `mode`, `subject`, `quoted_html`, `source_message_id`.
 */

import type { InboxMessage } from './inbox-api'

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
}

/** Extract bare lowercase addresses from "Name <a@b>" / comma-separated headers. */
export function parseAddressList(raw: string | null | undefined): string[] {
  if (!raw) return []
  const out: string[] = []
  for (const part of raw.split(',')) {
    const match = part.match(/<([^<>\s]+@[^<>\s]+)>/) || part.match(/([^\s,;"<>]+@[^\s,;"<>]+)/)
    const addr = match?.[1]?.trim().toLowerCase()
    if (addr && !out.includes(addr)) out.push(addr)
  }
  return out
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
  const toLine = message.toHeader || message.toAddresses || ''
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
    `<div dir="ltr" style="font-family:Calibri,sans-serif;font-size:11pt;color:#000">` +
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
  }
}
