/**
 * Unsent mail-native drafts, persisted per conversation in localStorage.
 *
 * The mail composer autosaves while the operator types; closing it (Esc / X),
 * switching threads or reloading never loses the mail. The thread shows a
 * draft chip that reopens the composer with everything restored. The quoted
 * mail history is intentionally not stored — it is rebuilt from the source
 * message on resume, which keeps the stored draft small and always fresh.
 */

import type { MessageAttachment } from './inbox-api'
import type { MailComposerMode } from './mail-reply'

export type StoredMailDraft = {
  mode: MailComposerMode
  /** Message the draft replies to / forwards; used to rebuild the intent. */
  sourceMessageId: string
  to: string
  cc: string
  bcc: string
  subject: string
  body: string
  attachments: MessageAttachment[]
  /** Mailbox chosen in the From selector. */
  channelAccountId: string | null
  updatedAt: string
}

export const mailDraftStorageKey = (threadId: string) => `inbox.mailDraft.${threadId}`

/** Same-tab signal when a draft is parked/cleared outside MailComposer (e.g. soft-undo). */
export const MAIL_DRAFT_CHANGED_EVENT = 'bokito:mail-draft-changed'

function notifyMailDraftChanged(threadId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(MAIL_DRAFT_CHANGED_EVENT, { detail: { threadId: String(threadId) } }),
  )
}

const MODES: readonly MailComposerMode[] = ['reply', 'reply_all', 'forward', 'new']

/** A draft is only worth keeping when there is something to send. */
export function mailDraftHasContent(
  draft: Pick<StoredMailDraft, 'body' | 'attachments'>,
): boolean {
  return Boolean(draft.body.trim()) || draft.attachments.length > 0
}

export function readStoredMailDraft(
  threadId: string | null | undefined,
): StoredMailDraft | null {
  if (!threadId || typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(mailDraftStorageKey(threadId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredMailDraft>
    if (
      !parsed ||
      typeof parsed.body !== 'string' ||
      typeof parsed.sourceMessageId !== 'string' ||
      !MODES.includes(parsed.mode as MailComposerMode)
    ) {
      return null
    }
    const draft: StoredMailDraft = {
      mode: parsed.mode as MailComposerMode,
      sourceMessageId: parsed.sourceMessageId,
      to: typeof parsed.to === 'string' ? parsed.to : '',
      cc: typeof parsed.cc === 'string' ? parsed.cc : '',
      bcc: typeof parsed.bcc === 'string' ? parsed.bcc : '',
      subject: typeof parsed.subject === 'string' ? parsed.subject : '',
      body: parsed.body,
      attachments: Array.isArray(parsed.attachments) ? parsed.attachments : [],
      channelAccountId:
        typeof parsed.channelAccountId === 'string' ? parsed.channelAccountId : null,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    }
    return mailDraftHasContent(draft) ? draft : null
  } catch {
    return null
  }
}

/** Persists the draft; an empty draft removes the stored entry instead. */
export function writeStoredMailDraft(
  threadId: string | null | undefined,
  draft: StoredMailDraft,
): void {
  if (!threadId || typeof window === 'undefined') return
  try {
    if (mailDraftHasContent(draft)) {
      window.localStorage.setItem(mailDraftStorageKey(threadId), JSON.stringify(draft))
    } else {
      window.localStorage.removeItem(mailDraftStorageKey(threadId))
    }
    notifyMailDraftChanged(threadId)
  } catch {
    // Quota / private mode: the draft just is not persisted.
  }
}

/** Drop the unsent mail draft (sent, discarded, conversation closed). */
export function clearStoredMailDraft(threadId: string | null | undefined): void {
  if (!threadId || typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(mailDraftStorageKey(threadId))
    notifyMailDraftChanged(threadId)
  } catch {
    // Private mode / quota: nothing to clear.
  }
}
