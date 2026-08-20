import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle, AlertCircle, Mail } from 'lucide-react'
import { toast } from 'sonner'
import { resendVerificationEmail, verifyEmail } from '../lib/api'

type VerifyState = 'pending' | 'success' | 'error' | 'missing'

export default function VerifyEmail() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token')
  const [state, setState] = useState<VerifyState>(token ? 'pending' : 'missing')
  const [error, setError] = useState('')
  const [resendEmail, setResendEmail] = useState('')
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
          setError(err instanceof Error ? err.message : 'Verification failed')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  const handleResend = async (event: React.FormEvent) => {
    event.preventDefault()
    const email = resendEmail.trim()
    if (!email) return
    setResending(true)
    try {
      const result = await resendVerificationEmail(email)
      if (result.dev_link) setDevLink(result.dev_link)
      toast.success('Verification email sent if applicable.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not resend verification email')
    } finally {
      setResending(false)
    }
  }

  if (state === 'pending') {
    return (
      <AuthShell title="Verifying email" subtitle="Please wait while we confirm your address.">
        <p className="text-sm text-text-secondary text-center">Verifying...</p>
      </AuthShell>
    )
  }

  if (state === 'success') {
    return (
      <AuthShell title="Email verified" subtitle="Your email address is confirmed.">
        <div className="text-center">
          <CheckCircle className="w-16 h-16 text-status-success mx-auto mb-4" />
          <p className="text-text-secondary mb-6">You can sign in with your account.</p>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-md transition-colors"
          >
            Sign in
          </Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title={state === 'missing' ? 'Verify your email' : 'Verification failed'}
      subtitle={
        state === 'missing'
          ? 'This link is missing a token. Request a new verification email below.'
          : 'The link may have expired. Request a new one below.'
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
            Email
          </label>
          <input
            id="resend-email"
            type="email"
            value={resendEmail}
            onChange={(event) => setResendEmail(event.target.value)}
            placeholder="you@company.com"
            className="w-full px-4 py-2.5 rounded-md bg-bg-input border border-border text-text-primary placeholder-text-muted text-sm focus:outline-none focus:border-border-focus transition"
            required
          />
        </div>
        <button
          type="submit"
          disabled={resending || !resendEmail.trim()}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-md text-sm font-semibold text-white bg-accent hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed transition"
        >
          <Mail size={16} />
          {resending ? 'Sending...' : 'Resend verification email'}
        </button>
      </form>

      {devLink ? (
        <div className="mt-4 rounded-md border border-border bg-bg-input/50 px-4 py-3 text-sm">
          <p className="font-medium text-text-heading mb-1">Local dev verification link</p>
          <Link to={devLink} className="break-all text-accent hover:text-accent-hover">
            {devLink}
          </Link>
        </div>
      ) : null}

      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={() => navigate('/login')}
          className="inline-flex items-center gap-2 text-sm text-accent hover:text-accent-hover transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to sign in
        </button>
      </div>
    </AuthShell>
  )
}

function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-accent/10 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img
            src="/bokito-logo-in-circel.svg"
            alt="Bokito.ai"
            className="w-12 h-12 mb-3"
            onError={(event) => {
              (event.target as HTMLImageElement).style.display = 'none'
            }}
          />
          <span className="text-2xl font-semibold text-text-heading tracking-tight">Bokito.ai</span>
          <span className="text-sm text-text-secondary mt-1">{subtitle}</span>
        </div>

        <div className="bg-bg-surface border border-border/60 rounded-xl p-8 shadow-overlay animate-page-enter">
          <h1 className="text-xl font-semibold text-text-heading mb-4 text-center">{title}</h1>
          {children}
        </div>

        <p className="text-center text-xs text-text-muted mt-6">
          © {new Date().getFullYear()} Bokito.ai · All rights reserved
        </p>
      </div>
    </div>
  )
}
