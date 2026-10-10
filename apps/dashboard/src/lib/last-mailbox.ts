/**
 * Last mailbox the operator sent from / picked in the composer.
 * Used as the default From when a thread has no bound channel yet.
 */
const LAST_MAILBOX_KEY = 'bokito.lastMailboxChannelAccountId'

export function readLastMailboxChannelAccountId(): string | null {
  try {
    const value = window.localStorage.getItem(LAST_MAILBOX_KEY)
    return value && value.trim() ? value.trim() : null
  } catch {
    return null
  }
}

export function writeLastMailboxChannelAccountId(channelAccountId: string | null | undefined): void {
  if (!channelAccountId?.trim()) return
  try {
    window.localStorage.setItem(LAST_MAILBOX_KEY, channelAccountId.trim())
  } catch {
    // ignore quota / private mode
  }
}
