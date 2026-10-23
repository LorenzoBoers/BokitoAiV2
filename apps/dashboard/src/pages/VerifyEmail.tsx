import { useEffect, useState } from 'react'
import { Spinner } from '../components/ui/spinner'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle, AlertCircle, Mail } from 'lucide-react'
import { toast } from 'sonner'
import { resendVerificationEmail, verifyEmail } from '../lib/api'
import { AuthShell } from '../components/auth/AuthShell'
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

type VerifyState = 'pending' | 'success' | 'error' | 'missing'

export default function VerifyEmail() {
  const { t } = useTranslation('nav')
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token')
  const [state, setState] = useState<VerifyState>(token ? 'pending' : 'missing')
  const [error, setError] = useState('')
  const [resendEmail, setResendEmail] = useState(() => searchParams.get('email') ?? '')
  const [resending, setResending] = useState(false)
  const [devLink, setDevLink] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void (async () => {
      try {
        await verifyEmail(token)
        if (!cancelled) setState('success')
      } catch (err) {
        if (!cancelled) {
          setState('error')
          setError(err instanceof Error ? err.message : t('verifyEmailPage.failed'))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, t])

  const handleResend = async (event: React.FormEvent) => {
    event.preventDefault()
    const email = resendEmail.trim()
    if (!email) return
    setResending(true)
    try {
      const result = await resendVerificationEmail(email)
      if (result.dev_link) setDevLink(result.dev_link)
      toast.success(t('verifyEmailPage.sentToast'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('verifyEmailPage.resendFailed'))
    } finally {
      setResending(false)
    }
  }

  if (state === 'pending') {
    return (
      <AuthShell title={t('verifyEmailPage.pendingTitle')} subtitle={t('verifyEmailPage.pendingSubtitle')}>
        <div className="flex flex-col items-center gap-3 text-center">
          <Spinner size="xl" className="text-accent" />
          <p className="text-sm text-text-secondary">{t('verifyEmailPage.pending')}</p>
        </div>
      </AuthShell>
    )
  }

  if (state === 'success') {
    return (
      <AuthShell title={t('verifyEmailPage.successTitle')} subtitle={t('verifyEmailPage.successSubtitle')}>
        <div className="text-center">
          <CheckCircle className="w-16 h-16 text-status-success mx-auto mb-4" />
          <p className="text-text-secondary mb-6">{t('verifyEmailPage.successBody')}</p>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-accent-fg rounded-md transition-colors"
          >
            {t('loginPage.signIn')}
          </Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title={state === 'missing' ? t('verifyEmailPage.missingTitle') : t('verifyEmailPage.errorTitle')}
      subtitle={
        state === 'missing'
          ? t('verifyEmailPage.missingSubtitle')
          : t('verifyEmailPage.errorSubtitle')
      }
    >
      {state === 'error' && error ? (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-status-error/30 bg-status-error/10 px-4 py-3 text-sm text-status-error">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <form onSubmit={handleResend} className="space-y-4">
        <div>
          <label htmlFor="resend-email" className="block text-sm font-medium text-text-secondary mb-1.5">
            {t('loginPage.email')}
          </label>
          <Input
            id="resend-email"
            type="email"
            value={resendEmail}
            onChange={(event) => setResendEmail(event.target.value)}
            placeholder={t('verifyEmailPage.emailPlaceholder')}
            className="h-10"
            required
          />
        </div>
        <Button size="lg"
          type="submit"
          disabled={resending || !resendEmail.trim()}
          className="w-full"
        >
          <Mail size={16} />
          {resending ? t('verifyEmailPage.sending') : t('verifyEmailPage.resend')}
        </Button>
      </form>

      {devLink ? (
        <div className="mt-4 rounded-md border border-border bg-bg-input/50 px-4 py-3 text-sm">
          <p className="font-medium text-text-heading mb-1">{t('verifyEmailPage.devTitle')}</p>
          <Link to={devLink} className="break-all text-accent hover:text-accent-hover">
            {devLink}
          </Link>
          <button
            type="button"
            className="mt-2 block text-xs font-medium text-accent hover:underline"
            onClick={() => {
              void navigator.clipboard.writeText(devLink).then(
                () => toast.success(t('verifyEmailPage.copied')),
                () => toast.error(t('verifyEmailPage.copyFailed')),
              )
            }}
          >
            {t('verifyEmailPage.copyLink')}
          </button>
        </div>
      ) : null}

      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={() => navigate('/login')}
          className="inline-flex items-center gap-2 text-sm text-accent hover:text-accent-hover transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('loginPage.backToSignIn')}
        </button>
      </div>
    </AuthShell>
  )
}
