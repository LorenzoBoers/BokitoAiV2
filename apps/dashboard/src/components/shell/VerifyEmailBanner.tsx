import { useState } from 'react'
import { MailWarning } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { resendVerificationEmail } from '../../lib/api'

/**
 * Soft verification gate: shown while the signed-in user's email address is
 * unverified. Outbound actions (replies, connecting mailboxes) are blocked
 * server-side until the emailed link is clicked; this banner explains why and
 * offers a resend. Invite-accepted and SSO users are verified on arrival and
 * never see it.
 */
export default function VerifyEmailBanner() {
  const { user } = useAuth()
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  if (!user || user.emailVerified) return null

  const resend = async () => {
    if (!user.email || sending) return
    setSending(true)
    try {
      const result = await resendVerificationEmail(user.email)
      setSent(true)
      if (result.dev_link) {
        toast.success('Verification email sent. Dev link available in the server logs.')
      } else {
        toast.success(`Verification email sent to ${user.email}.`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the verification email.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex items-center gap-3 border-b border-status-warning/30 bg-status-warning/10 px-4 py-1.5 text-[13px] text-text-primary">
      <MailWarning size={14} className="shrink-0 text-status-warning" />
      <span className="min-w-0 truncate">
        Verify {user.email} to send messages and connect mailboxes.
      </span>
      <button
        type="button"
        onClick={() => void resend()}
        disabled={sending || sent}
        className="ml-auto shrink-0 rounded-md border border-border/60 px-2.5 py-0.5 font-medium text-text-heading transition-colors hover:bg-bg-hover disabled:opacity-60"
      >
        {sent ? 'Sent' : sending ? 'Sending...' : 'Resend email'}
      </button>
    </div>
  )
}
