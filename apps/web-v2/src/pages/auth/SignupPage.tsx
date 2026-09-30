import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'

import { ApiError } from '@/lib/api'
import { signup, useToken } from '@/lib/auth'
import { AuthLayout } from './AuthLayout'

function validationMessage(err: ApiError): string | null {
  const first = Array.isArray(err.details) ? (err.details[0] as { loc?: unknown[]; msg?: string } | undefined) : undefined
  if (!first?.msg) return null
  const field = first.loc?.filter((p) => p !== 'body').join('.')
  return field ? `${field}: ${first.msg}` : first.msg
}

export function SignupPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const token = useToken()
  const [params] = useSearchParams()
  const invite = params.get('invite') ?? undefined
  const [form, setForm] = useState({ name: '', email: '', password: '', workspace_name: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (token) return <Navigate to="/" replace />

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signup({ ...form, invite, language: i18n.language.startsWith('nl') ? 'nl' : 'en' })
      navigate('/', { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'email_taken') setError(t('auth.emailTaken'))
      else if (err instanceof ApiError && err.code === 'invite_invalid') setError(t('auth.inviteInvalid'))
      else if (err instanceof ApiError && err.code === 'validation_error') setError(validationMessage(err) ?? t('common.error'))
      else setError(t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={invite ? t('auth.joinWorkspace') : t('auth.signup')}>
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block text-xs text-text-secondary">
          {t('auth.name')}
          <input className="field mt-1" required value={form.name} onChange={set('name')} />
        </label>
        {!invite && (
          <label className="block text-xs text-text-secondary">
            {t('auth.workspaceName')}
            <input className="field mt-1" required value={form.workspace_name} onChange={set('workspace_name')} />
          </label>
        )}
        <label className="block text-xs text-text-secondary">
          {t('auth.email')}
          <input className="field mt-1" type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
        </label>
        <label className="block text-xs text-text-secondary">
          {t('auth.password')}
          <input
            className="field mt-1"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={form.password}
            onChange={set('password')}
          />
        </label>
        {error && <p className="text-xs text-status-error">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {invite ? t('auth.joinWorkspace') : t('auth.signup')}
        </button>
      </form>
      <p className="mt-4 text-center text-xs text-text-muted">
        {t('auth.haveAccount')}{' '}
        <Link to="/login" className="text-accent-ink hover:underline">
          {t('auth.login')}
        </Link>
      </p>
    </AuthLayout>
  )
}
