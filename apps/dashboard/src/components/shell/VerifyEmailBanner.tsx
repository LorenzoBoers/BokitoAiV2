import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('nav')
  const { user } = useAuth()
  const [sending, setSending] = useState(false)
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [cooldownUntil])

  if (!user || user.emailVerified) return null

  const remaining = Math.max(0, Math.ceil((cooldownUntil - now) / 1000))

  const resend = async () => {
    if (!user.email || sending || remaining > 0) return
    setSending(true)
    try {
      const result = await resendVerificationEmail(user.email)
      setCooldownUntil(Date.now() + 60_000)
      if (result.dev_link) {
        toast.success(t('verifyEmail.sentDev'))
      } else {
        toast.success(t('verifyEmail.sentToast', { email: user.email }))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('verifyEmail.failed'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex items-center gap-3 border-b border-status-warning/30 bg-status-warning/10 px-4 py-1.5 text-[13px] text-text-primary">
      <MailWarning size={14} className="shrink-0 text-status-warning" />
      <span className="min-w-0 truncate">
        {t('verifyEmail.body', { email: user.email })}
      </span>
      <button
        type="button"
        onClick={() => void resend()}
        disabled={sending || remaining > 0}
        className="ml-auto shrink-0 rounded-md border border-border/60 px-2.5 py-0.5 font-medium text-text-heading transition-colors hover:bg-bg-hover disabled:opacity-60"
      >
        {sending
          ? t('verifyEmail.sending')
          : remaining > 0
            ? t('verifyEmail.resendIn', { seconds: remaining })
            : t('verifyEmail.resend')}
      </button>
    </div>
  )
}
