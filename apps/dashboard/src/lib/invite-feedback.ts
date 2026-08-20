/**
 * User-facing feedback for invite create/resend responses.
 *
 * The backend always returns the invite row, plus `mail_sent`: false means no
 * mail provider is configured (dev, or unconfigured prod) and the copyable
 * invite link is the only way to reach the invitee.
 */

export type InviteMailFeedback =
  | { kind: 'success'; message: string }
  | { kind: 'warning'; message: string; inviteLink: string | null }

export function inviteMailFeedback(email: string, result: unknown): InviteMailFeedback {
  const row = result && typeof result === 'object' ? (result as Record<string, unknown>) : null
  const inviteLink = typeof row?.invite_link === 'string' ? row.invite_link : null
  if (row?.mail_sent === false) {
    return {
      kind: 'warning',
      message: inviteLink
        ? `Email to ${email} was not sent (mail is not configured). The invite link was copied - share it directly.`
        : `Email to ${email} was not sent (mail is not configured). Share the invite link from the row actions instead.`,
      inviteLink,
    }
  }
  return { kind: 'success', message: `Invite sent to ${email}` }
}
