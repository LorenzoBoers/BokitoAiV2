import { useRef, useState, useCallback, type KeyboardEvent, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, LaptopMinimal, Lock, Moon, Pencil, ShieldCheck, Sun, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { UserAvatar } from '../ui/UserAvatar'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { authRoutes } from '../../api/routes/auth.routes'
import { apiPatchAuth, apiPostAuth, AUTH_API_BASE, buildAuthHeaders, resendVerificationEmail } from '../../lib/api'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

// ── inline editable field ────────────────────────────────────────────────────

function EditableField({
  label,
  value,
  placeholder,
  onSave,
  type = 'text',
}: {
  label: string
  value: string
  placeholder?: string
  onSave: (next: string) => Promise<void>
  type?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const startEdit = () => {
    setDraft(value)
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const cancel = () => {
    setEditing(false)
    setDraft(value)
  }

  const save = async () => {
    if (draft === value) { setEditing(false); return }
    setSaving(true)
    try {
      await onSave(draft)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      setEditing(false)
    } catch (err) {
      // Keep edit mode open so the user does not mistake a failure for a save.
      toast.error(err instanceof Error ? err.message : `Could not save ${label.toLowerCase()}.`)
    } finally {
      setSaving(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void save()
    if (e.key === 'Escape') cancel()
  }

  return (
    <div className="group flex items-center gap-4 border-b border-border/50 py-3.5 pr-4 last:border-b-0">
      <span className="w-36 shrink-0 text-sm font-medium text-text-heading">{label}</span>

      {editing ? (
        <div className="flex flex-1 items-center justify-end gap-2">
          <Input
            ref={inputRef}
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            className="h-8 w-52 rounded-lg border-border/60 text-sm"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-50"
          >
            <Check size={13} />
          </button>
          <button
            type="button"
            onClick={cancel}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/70 text-text-muted hover:text-text-primary"
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-end gap-2">
          {saved && <Check size={12} className="text-status-success" />}
          <span className={`text-sm ${value ? 'text-text-primary' : 'text-text-muted'}`}>
            {value || placeholder}
          </span>
          <button
            type="button"
            onClick={startEdit}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-text-primary hover:bg-bg-hover"
          >
            <Pencil size={12} />
          </button>
        </div>
      )}
    </div>
  )
}

// ── section wrapper ──────────────────────────────────────────────────────────

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-[15px] font-semibold text-text-heading">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-text-muted">{description}</p>}
      </div>
      {children}
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-bg-surface/80 px-4">
      {children}
    </div>
  )
}

// ── theme card ───────────────────────────────────────────────────────────────

type ThemeVariant = 'light' | 'dark' | 'system'

interface ThemeTokens {
  chrome: string       // outermost window bg
  sidebar: string      // left nav
  content: string      // main content area
  card: string         // card / row bg
  accent: string       // purple accent bar
  muted: string        // muted lines
  border: string
}

const T: Record<'light' | 'dark', ThemeTokens> = {
  light: {
    chrome:  '#eceef0',
    sidebar: '#f4f5f7',
    content: '#ffffff',
    card:    '#f0f1f3',
    accent:  '#635bff',
    muted:   '#d0d2d8',
    border:  '#dde0e6',
  },
  dark: {
    chrome:  '#0d0d10',
    sidebar: '#141418',
    content: '#1a1a22',
    card:    '#22222c',
    accent:  '#635bff',
    muted:   '#2e2e3a',
    border:  '#242430',
  },
}

function AppFrame({ tokens }: { tokens: ThemeTokens }) {
  return (
    <div
      className="flex h-full w-full overflow-hidden rounded-[5px]"
      style={{ background: tokens.chrome, border: `1px solid ${tokens.border}` }}
    >
      {/* Sidebar */}
      <div className="flex w-[30%] flex-col gap-1.5 p-2" style={{ background: tokens.sidebar }}>
        <div className="h-2 w-8 rounded-full" style={{ background: tokens.accent }} />
        <div className="h-1.5 w-10 rounded-full" style={{ background: tokens.muted }} />
        <div className="h-1.5 w-7 rounded-full" style={{ background: tokens.muted }} />
        <div className="h-1.5 w-9 rounded-full" style={{ background: tokens.muted }} />
      </div>
      {/* Content */}
      <div className="flex flex-1 flex-col gap-1.5 p-2" style={{ background: tokens.content }}>
        <div className="h-2 w-12 rounded-full" style={{ background: tokens.muted }} />
        <div className="h-5 rounded-md" style={{ background: tokens.card }} />
        <div className="h-5 rounded-md" style={{ background: tokens.card }} />
        <div className="h-5 rounded-md" style={{ background: tokens.card }} />
      </div>
    </div>
  )
}

function ThemeOption({ label, icon, active, onClick, variant }: {
  label: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
  variant: ThemeVariant
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-xl border p-2.5 transition-all ${
        active
          ? 'border-accent shadow-[0_0_0_1px_rgba(99,91,255,0.4)]'
          : 'border-border/60 hover:border-border'
      }`}
    >
      <div className="h-[88px] overflow-hidden rounded-lg">
        {variant === 'system' ? (
          <div className="flex h-full">
            <div className="w-1/2 overflow-hidden" style={{ clipPath: 'inset(0)' }}>
              <div className="h-full w-[200%]">
                <AppFrame tokens={T.light} />
              </div>
            </div>
            <div className="w-px shrink-0" style={{ background: '#888' }} />
            <div className="w-1/2 overflow-hidden" style={{ clipPath: 'inset(0)' }}>
              <div className="relative h-full w-[200%]" style={{ marginLeft: '-100%' }}>
                <AppFrame tokens={T.dark} />
              </div>
            </div>
          </div>
        ) : (
          <AppFrame tokens={T[variant]} />
        )}
      </div>
      <span className="mt-2 flex items-center justify-center gap-1.5 text-xs font-medium text-text-secondary">
        {icon}{label}
      </span>
    </button>
  )
}

// ── main ─────────────────────────────────────────────────────────────────────

export function ProfileSettingsContent() {
  const { t, i18n } = useTranslation(['profile', 'common'])
  const { user, token, logout, patchLocalUser, refreshUser } = useAuth()
  const { mode, setMode } = useTheme()

  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [verifySending, setVerifySending] = useState(false)

  const handleAvatarChange = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !token) return
    setAvatarUploading(true)
    try {
      const form = new FormData()
      form.append('avatar', file)
      const headers = buildAuthHeaders(token, false) // no Content-Type — browser sets multipart boundary
      const sendAvatar = async (path: string) => fetch(`${AUTH_API_BASE}${path}`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: form,
      })
      let res = await sendAvatar(authRoutes.users.meAvatar)
      if (res.status === 404) {
        // Backward compatibility while some environments still use legacy path.
        res = await sendAvatar(authRoutes.users.avatarLegacy)
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { avatar?: { url?: string; path?: string } }
      const url = data.avatar?.url ?? data.avatar?.path ?? null
      if (url) patchLocalUser({ avatarUrl: url })
    } catch (err) {
      toast.error(err instanceof Error ? `Could not upload avatar (${err.message}).` : 'Could not upload avatar.')
    } finally {
      setAvatarUploading(false)
      // Reset so the same file can be re-selected
      e.target.value = ''
    }
  }, [token, patchLocalUser])

  // Account deletion
  const [deleting, setDeleting] = useState(false)
  const handleDeleteAccount = useCallback(async () => {
    if (!token || deleting) return
    if (!window.confirm(t('profile:account.deleteConfirm'))) return
    const password = window.prompt(t('profile:account.deletePasswordPrompt'))
    if (!password) return
    setDeleting(true)
    try {
      await apiPostAuth(authRoutes.profile.deleteAccount, { password }, token)
      await logout()
      window.location.assign('/login')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the account.')
      setDeleting(false)
    }
  }, [token, deleting, t, logout])

  // Password form
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSaved, setPwSaved] = useState(false)

  const saveName = useCallback(async (next: string) => {
    if (!token) return
    await apiPatchAuth(authRoutes.profile.patch, { name: next }, token)
    patchLocalUser({ name: next })
  }, [token, patchLocalUser])

  const saveEmail = useCallback(async (next: string) => {
    if (!token) return
    await apiPatchAuth(authRoutes.profile.patch, { email: next }, token)
    patchLocalUser({ email: next, emailVerified: false })
    void refreshUser()
  }, [token, patchLocalUser, refreshUser])

  const handleResendVerification = useCallback(async () => {
    if (!user?.email) return
    setVerifySending(true)
    try {
      const result = await resendVerificationEmail(user.email)
      if (result.dev_link) {
        toast.success('Verification email sent. Check the dev link in the API response or server logs.')
      } else {
        toast.success('Verification email sent if applicable.')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not resend verification email')
    } finally {
      setVerifySending(false)
    }
  }, [user?.email])

  const saveJobTitle = useCallback(async (next: string) => {
    if (!token) return
    await apiPatchAuth(authRoutes.profile.patch, { job_title: next }, token)
    patchLocalUser({ jobTitle: next || null })
  }, [token, patchLocalUser])

  const handleChangePassword = async () => {
    if (newPw !== confirmPw) { setPwError(t('profile:security.passwordMismatch')); return }
    if (!token) return
    setPwSaving(true); setPwError(null)
    try {
      await apiPostAuth(authRoutes.profile.changePassword, { current_password: currentPw, new_password: newPw }, token)
      setPwSaved(true)
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
      setShowPasswordForm(false)
      setTimeout(() => setPwSaved(false), 3000)
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Change failed')
    } finally {
      setPwSaving(false)
    }
  }

  // ── Two-factor authentication (TOTP) ──
  const [totpSetup, setTotpSetup] = useState<{ secret: string; otpauthUri: string } | null>(null)
  const [totpEnrollCode, setTotpEnrollCode] = useState('')
  const [totpDisablePw, setTotpDisablePw] = useState('')
  const [showTotpDisable, setShowTotpDisable] = useState(false)
  const [totpBusy, setTotpBusy] = useState(false)
  const [totpError, setTotpError] = useState<string | null>(null)

  const startTotpSetup = async () => {
    if (!token) return
    setTotpBusy(true); setTotpError(null)
    try {
      const data = await apiPostAuth<{ secret: string; otpauth_uri: string }>(
        authRoutes.twoFactor.setup, {}, token,
      )
      setTotpSetup({ secret: data.secret, otpauthUri: data.otpauth_uri })
      setTotpEnrollCode('')
    } catch (err) {
      setTotpError(err instanceof Error ? err.message : 'Could not start 2FA setup')
    } finally {
      setTotpBusy(false)
    }
  }

  const confirmTotpEnable = async () => {
    if (!token) return
    setTotpBusy(true); setTotpError(null)
    try {
      await apiPostAuth(authRoutes.twoFactor.enable, { code: totpEnrollCode }, token)
      patchLocalUser({ totpEnabled: true })
      setTotpSetup(null)
      setTotpEnrollCode('')
      toast.success(t('profile:security.totpEnabled', { defaultValue: 'Two-factor authentication enabled' }))
    } catch {
      setTotpError(t('profile:security.totpInvalidCode', { defaultValue: 'Invalid verification code. Try again.' }))
    } finally {
      setTotpBusy(false)
    }
  }

  const disableTotp = async () => {
    if (!token) return
    setTotpBusy(true); setTotpError(null)
    try {
      await apiPostAuth(authRoutes.twoFactor.disable, { password: totpDisablePw }, token)
      patchLocalUser({ totpEnabled: false })
      setShowTotpDisable(false)
      setTotpDisablePw('')
      toast.success(t('profile:security.totpDisabled', { defaultValue: 'Two-factor authentication disabled' }))
    } catch (err) {
      setTotpError(err instanceof Error ? err.message : 'Could not disable 2FA')
    } finally {
      setTotpBusy(false)
    }
  }

  return (
    <div className="space-y-7">

      {/* ── Profile ── */}
      <Section title={t('profile:personalInformation.title')} description={t('profile:personalInformation.description')}>
        <Card>
          {/* Avatar */}
          <div className="flex items-center justify-between border-b border-border/50 py-3.5 pr-4">
            <span className="w-36 shrink-0 text-sm font-medium text-text-heading">{t('profile:personalInformation.profilePicture')}</span>
              <button
              type="button"
              onClick={() => !avatarUploading && avatarInputRef.current?.click()}
              disabled={avatarUploading}
              className="group relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full transition-opacity hover:opacity-80 disabled:cursor-wait"
              title={t('profile:personalInformation.uploadPhoto')}
            >
              <UserAvatar name={user?.name ?? '?'} email={user?.email ?? ''} avatarUrl={user?.avatarUrl} size={40} />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                {avatarUploading
                  ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  : <Pencil size={12} className="text-white" />}
              </span>
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
              onChange={(e) => void handleAvatarChange(e)}
            />
          </div>

          {/* Email */}
          <EditableField
            label={t('profile:personalInformation.email')}
            value={user?.email ?? ''}
            type="email"
            onSave={saveEmail}
          />

          {user && !user.emailVerified ? (
            <div className="flex items-center justify-between gap-3 border-b border-border/50 py-3.5 pr-4">
              <div>
                <p className="text-sm font-medium text-text-heading">Email verification</p>
                <p className="text-xs text-text-muted">Confirm your email address to secure the account.</p>
              </div>
              <Button size="sm" variant="secondary" disabled={verifySending} onClick={() => void handleResendVerification()}>
                {verifySending ? 'Sending...' : 'Resend email'}
              </Button>
            </div>
          ) : null}

          {/* Name */}
          <EditableField
            label={t('profile:personalInformation.fullName')}
            value={user?.name ?? ''}
            onSave={saveName}
          />

          {/* Job title */}
          <EditableField
            label={t('profile:personalInformation.jobTitle')}
            value={user?.jobTitle ?? ''}
            placeholder={t('profile:personalInformation.jobTitlePlaceholder')}
            onSave={saveJobTitle}
          />
        </Card>
      </Section>

      {/* ── Language ── */}
      <Section title={t('profile:language.title')} description={t('profile:language.description')}>
        <div className="flex gap-2">
          {(['nl', 'en'] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => void i18n.changeLanguage(lang)}
              className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                i18n.language === lang
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border/60 text-text-secondary hover:border-border hover:text-text-primary'
              }`}
            >
              {lang === 'nl' ? t('profile:language.dutch') : t('profile:language.english')}
            </button>
          ))}
        </div>
      </Section>

      {/* ── Appearance ── */}
      <Section title={t('profile:theme.title')} description={t('profile:theme.description')}>
        <div className="grid grid-cols-3 gap-2.5 rounded-xl border border-border/60 bg-bg-surface/80 p-3">
          <ThemeOption variant="light" label={t('profile:theme.light')} icon={<Sun size={12} />} active={mode === 'light'} onClick={() => setMode('light')} />
          <ThemeOption variant="dark" label={t('profile:theme.dark')} icon={<Moon size={12} />} active={mode === 'dark'} onClick={() => setMode('dark')} />
          <ThemeOption variant="system" label={t('profile:theme.system')} icon={<LaptopMinimal size={12} />} active={mode === 'system'} onClick={() => setMode('system')} />
        </div>
      </Section>

      {/* ── Security ── */}
      <Section title={t('profile:security.title')} description={t('profile:security.description')}>
        <Card>
          {/* Password */}
          <div className="border-b border-border/50 py-3.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-text-heading">{t('profile:security.passwordTitle')}</p>
                <p className="text-xs text-text-muted">{t('profile:security.passwordDescription')}</p>
              </div>
              <div className="flex items-center gap-2">
                {pwSaved && <span className="flex items-center gap-1 text-xs text-status-success"><Check size={12} />{t('profile:security.passwordSuccess')}</span>}
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-lg px-3 text-xs"
                  onClick={() => { setShowPasswordForm((v) => !v); setPwError(null) }}
                >
                  <Lock size={12} />
                  {t('profile:security.changePassword')}
                </Button>
              </div>
            </div>

            {showPasswordForm && (
              <div className="mt-3 space-y-2.5 rounded-lg border border-border/50 bg-bg-elevated/50 p-3">
                <div className="grid gap-2.5 sm:grid-cols-3">
                  {[
                    { label: t('profile:security.currentPassword'), value: currentPw, set: setCurrentPw },
                    { label: t('profile:security.newPassword'), value: newPw, set: setNewPw },
                    { label: t('profile:security.confirmPassword'), value: confirmPw, set: setConfirmPw },
                  ].map(({ label, value, set }) => (
                    <div key={label} className="space-y-1">
                      <label className="text-[11px] uppercase tracking-wide text-text-muted">{label}</label>
                      <Input
                        type="password"
                        value={value}
                        onChange={(e) => set(e.target.value)}
                        className="h-8 rounded-lg text-sm"
                      />
                    </div>
                  ))}
                </div>
                {pwError && <p className="text-xs text-status-error">{pwError}</p>}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="h-8 rounded-lg px-3 text-xs"
                    disabled={pwSaving || !currentPw || !newPw || !confirmPw}
                    onClick={() => void handleChangePassword()}
                  >
                    {pwSaving ? t('profile:personalInformation.saving') : t('profile:security.changePassword')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 rounded-lg px-3 text-xs"
                    onClick={() => { setShowPasswordForm(false); setPwError(null) }}
                  >
                    {t('profile:security.cancel')}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Two-factor authentication */}
          <div className="py-3.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-text-heading">
                  {t('profile:security.totpTitle', { defaultValue: 'Two-factor authentication' })}
                </p>
                <p className="text-xs text-text-muted">
                  {user?.totpEnabled
                    ? t('profile:security.totpOnDescription', { defaultValue: 'Signing in requires a code from your authenticator app.' })
                    : t('profile:security.totpOffDescription', { defaultValue: 'Add an extra sign-in step with an authenticator app.' })}
                </p>
              </div>
              {user?.totpEnabled ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-lg px-3 text-xs"
                  onClick={() => { setShowTotpDisable((v) => !v); setTotpError(null) }}
                >
                  {t('profile:security.totpDisable', { defaultValue: 'Disable' })}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-lg px-3 text-xs"
                  disabled={totpBusy}
                  onClick={() => void (totpSetup ? setTotpSetup(null) : startTotpSetup())}
                >
                  <ShieldCheck size={12} />
                  {totpSetup
                    ? t('profile:security.cancel')
                    : t('profile:security.totpEnable', { defaultValue: 'Enable' })}
                </Button>
              )}
            </div>

            {totpSetup && !user?.totpEnabled && (
              <div className="mt-3 space-y-3 rounded-lg border border-border/50 bg-bg-elevated/50 p-3">
                <p className="text-xs text-text-secondary">
                  {t('profile:security.totpStep1', {
                    defaultValue: 'Add this key to your authenticator app (Google Authenticator, 1Password, Microsoft Authenticator, ...), then enter the 6-digit code it shows.',
                  })}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded-md border border-border/60 bg-bg-input px-2.5 py-1.5 font-mono text-[12px] tracking-wider text-text-primary">
                    {totpSetup.secret}
                  </code>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-7 rounded-lg px-2.5 text-[11px]"
                    onClick={() => {
                      void navigator.clipboard.writeText(totpSetup.secret)
                      toast.success(t('common:actions.copied', { defaultValue: 'Copied' }))
                    }}
                  >
                    {t('common:actions.copy', { defaultValue: 'Copy' })}
                  </Button>
                  <a
                    href={totpSetup.otpauthUri}
                    className="text-[11.5px] font-medium text-accent hover:text-accent-hover"
                  >
                    {t('profile:security.totpOpenApp', { defaultValue: 'Open in authenticator app' })}
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    inputMode="numeric"
                    maxLength={6}
                    value={totpEnrollCode}
                    onChange={(e) => setTotpEnrollCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className="h-8 w-28 rounded-lg text-center font-mono text-sm tracking-[0.25em]"
                  />
                  <Button
                    size="sm"
                    className="h-8 rounded-lg px-3 text-xs"
                    disabled={totpBusy || totpEnrollCode.length !== 6}
                    onClick={() => void confirmTotpEnable()}
                  >
                    {totpBusy
                      ? t('profile:personalInformation.saving')
                      : t('profile:security.totpConfirm', { defaultValue: 'Verify and enable' })}
                  </Button>
                </div>
                {totpError && <p className="text-xs text-status-error">{totpError}</p>}
              </div>
            )}

            {showTotpDisable && user?.totpEnabled && (
              <div className="mt-3 space-y-2.5 rounded-lg border border-border/50 bg-bg-elevated/50 p-3">
                <p className="text-xs text-text-secondary">
                  {t('profile:security.totpDisableConfirm', { defaultValue: 'Enter your password to turn off two-factor authentication.' })}
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    type="password"
                    value={totpDisablePw}
                    onChange={(e) => setTotpDisablePw(e.target.value)}
                    className="h-8 w-52 rounded-lg text-sm"
                    autoComplete="current-password"
                  />
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-8 rounded-lg px-3 text-xs"
                    disabled={totpBusy || !totpDisablePw}
                    onClick={() => void disableTotp()}
                  >
                    {t('profile:security.totpDisable', { defaultValue: 'Disable' })}
                  </Button>
                </div>
                {totpError && <p className="text-xs text-status-error">{totpError}</p>}
              </div>
            )}
          </div>

        </Card>
      </Section>

      {/* ── Account ── */}
      <Section title={t('profile:account.title')} description={t('profile:account.description')}>
        <Card>
          <div className="flex items-center justify-between border-b border-border/50 py-3.5">
            <div>
              <p className="text-sm font-medium text-text-heading">{t('profile:account.signOutTitle')}</p>
              <p className="text-xs text-text-muted">{t('profile:account.signOutDescription')}</p>
            </div>
            <Button variant="secondary" size="sm" className="h-8 rounded-lg px-3 text-xs" onClick={() => void logout()}>
              {t('common:actions.signOut')}
            </Button>
          </div>
          <div className="flex items-center justify-between py-3.5">
            <div>
              <p className="text-sm font-medium text-text-heading">{t('profile:account.deleteTitle')}</p>
              <p className="text-xs text-text-muted">{t('profile:account.deleteDescription')}</p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={() => void handleDeleteAccount()}
              className="h-8 rounded-lg px-3 text-xs"
            >
              <Trash2 size={12} />
              {deleting ? t('profile:account.deleting') : t('common:actions.delete')}
            </Button>
          </div>
        </Card>
      </Section>
    </div>
  )
}
