import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useNavigate } from 'react-router-dom'

import { ApiError } from '@/lib/api'
import { login, useToken } from '@/lib/auth'
import { AuthLayout } from './AuthLayout'

export function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const token = useToken()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (token) return <Navigate to="/" replace />

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401 ? t('auth.invalidCredentials') : t('common.error'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t('auth.login')}>
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block text-xs text-text-secondary">
          {t('auth.email')}
          <input
            className="field mt-1"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block text-xs text-text-secondary">
          {t('auth.password')}
          <input
            className="field mt-1"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="text-xs text-status-error">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {t('auth.login')}
        </button>
      </form>
      <p className="mt-4 text-center text-xs text-text-muted">
        {t('auth.noAccount')}{' '}
        <Link to="/signup" className="text-accent-ink hover:underline">
          {t('auth.signup')}
        </Link>
      </p>
    </AuthLayout>
  )
}
