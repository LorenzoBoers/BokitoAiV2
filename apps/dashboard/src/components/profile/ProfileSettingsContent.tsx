import { useRef, useState, useCallback, useEffect, useMemo, type KeyboardEvent, type ChangeEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check, LaptopMinimal, Lock, LogOut, Moon, Pencil, PenLine, ShieldCheck, Sun, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { UserAvatar } from '../ui/UserAvatar'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { authRoutes } from '../../api/routes/auth.routes'
import { apiPatchAuth, apiPostAuth, AUTH_API_BASE, buildAuthHeaders, resendVerificationEmail } from '../../lib/api'
import {
  getSsoIdentities,
  startSsoLink,
  unlinkSsoProvider,
  type SsoIdentitiesPayload,
  type SsoProviderId,
} from '../../lib/sso-api'
import { describeSsoError } from '../auth/sso-errors'
import { Button } from '../ui/button'
import { useConfirm } from '../ui/confirm-dialog'
import { Input } from '../ui/input'
import SignatureEditor from '../inbox/SignatureEditor'
import { previewSignatureHtml, type SignatureIdentityVars } from '../../lib/default-signature'
import { applyUiLanguageLocally, persistUiLanguage } from '../../lib/language-preference'
import {
  fetchDefaultLanding,
  persistDefaultLanding,
  readCachedDefaultLanding,
  type DefaultLanding,
} from '../../lib/landing-preference'

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
  const { t } = useTranslation('profile')

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
      toast.error(err instanceof Error ? err.message : t('errors.saveField', { label: label.toLowerCase() }))
    } finally {
      setSaving(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void save()
    if (e.key === 'Escape') cancel()
  }

  return (
    <div className="group flex items-center gap-4 border-b border-border/60 py-3.5 pr-4 last:border-b-0">
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
            aria-label={t('personalInformation.saveField', { label })}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-fg hover:bg-accent/90 disabled:opacity-50"
          >
            <Check size={13} />
          </button>
          <button
            type="button"
            onClick={cancel}
            aria-label={t('personalInformation.cancelEdit')}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 text-text-muted hover:text-text-primary"
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
            aria-label={t('personalInformation.editField', { label })}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-primary"
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
        <h3 className="text-lg font-semibold text-text-heading">{title}</h3>
        {description ? <p className="mt-0.5 text-sm text-text-muted">{description}</p> : null}
      </div>
      {children}
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="panel px-4">
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
      className={`flex-1 rounded-lg border p-2.5 transition-all ${
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
  const confirm = useConfirm()
  const [defaultLanding, setDefaultLanding] = useState<DefaultLanding>(() => readCachedDefaultLanding())

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void fetchDefaultLanding(token).then((landing) => {
      if (!cancelled) setDefaultLanding(landing)
    })
    return () => {
      cancelled = true
    }
  }, [token])

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
      toast.error(
        err instanceof Error
          ? t('profile:errors.uploadAvatarDetail', { detail: err.message })
          : t('profile:errors.uploadAvatar'),
      )
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
    if (!(await confirm({ description: t('profile:account.deleteConfirm'), destructive: true }))) return
    const password = window.prompt(t('profile:account.deletePasswordPrompt'))
    if (!password) return
    setDeleting(true)
    try {
      await apiPostAuth(authRoutes.profile.deleteAccount, { password }, token)
      await logout()
      window.location.assign('/login')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('profile:errors.deleteAccount'))
      setDeleting(false)
    }
  }, [token, deleting, t, logout, confirm])

  // Password form
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSaved, setPwSaved] = useState(false)
  const [pwJustSet, setPwJustSet] = useState(false)
  const hasPassword = user?.hasPassword === true

  // Connected SSO accounts
  const [ssoStatus, setSsoStatus] = useState<SsoIdentitiesPayload | null>(null)
  const [ssoBusy, setSsoBusy] = useState<SsoProviderId | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const reloadSso = useCallback(async () => {
    if (!token) return
    try {
      const data = await getSsoIdentities(token)
      setSsoStatus(data)
      if (data.has_password !== user?.hasPassword) {
        patchLocalUser({ hasPassword: data.has_password })
      }
    } catch {
      toast.error(t('profile:errors.ssoLoad'))
    }
  }, [token, t, patchLocalUser, user?.hasPassword])

  useEffect(() => {
    void reloadSso()
  }, [reloadSso])

  useEffect(() => {
    const linked = searchParams.get('sso')
    const err = searchParams.get('sso_error')
    if (!linked && !err) return
    if (linked === 'linked') {
      toast.success(t('profile:security.linkedToast'))
      void reloadSso()
    } else if (err) {
      toast.error(t(`loginPage.sso.${err}`, { ns: 'nav', defaultValue: describeSsoError(err) }))
    }
    const next = new URLSearchParams(searchParams)
    next.delete('sso')
    next.delete('sso_error')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, reloadSso, t])

  const handleSsoConnect = useCallback(
    async (provider: SsoProviderId) => {
      if (!token || ssoBusy) return
      setSsoBusy(provider)
      try {
        const returnUrl = `${window.location.origin}/settings/profile`
        const { authorize_url } = await startSsoLink(token, provider, returnUrl)
        window.location.assign(authorize_url)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('profile:errors.ssoLink'))
        setSsoBusy(null)
      }
    },
    [token, ssoBusy, t],
  )

  const handleSsoDisconnect = useCallback(
    async (provider: SsoProviderId) => {
      if (!token || ssoBusy) return
      const label = t(`profile:security.${provider}`)
      if (!(await confirm({ description: t('profile:security.disconnectConfirm', { provider: label }), confirmLabel: t('actions.disconnect', { ns: 'common' }), destructive: true }))) return
      setSsoBusy(provider)
      try {
        const data = await unlinkSsoProvider(token, provider)
        setSsoStatus(data)
        toast.success(t('profile:security.disconnectedToast'))
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('profile:errors.ssoUnlink')
        toast.error(msg.includes('password') || msg.includes('wachtwoord') ? t('profile:security.unlinkBlocked') : msg)
      } finally {
        setSsoBusy(null)
      }
    },
    [token, ssoBusy, t, confirm],
  )

  const saveFirstName = useCallback(async (next: string) => {
    if (!token) return
    await apiPatchAuth(authRoutes.profile.patch, { first_name: next }, token)
    const last = user?.lastName ?? ''
    const composed = [next.trim(), last].filter(Boolean).join(' ').trim()
    patchLocalUser({ firstName: next.trim(), name: composed || user?.email || next.trim() })
  }, [token, patchLocalUser, user?.lastName, user?.email])

  const saveLastName = useCallback(async (next: string) => {
    if (!token) return
    await apiPatchAuth(authRoutes.profile.patch, { last_name: next }, token)
    const first = user?.firstName ?? ''
    const composed = [first, next.trim()].filter(Boolean).join(' ').trim()
    patchLocalUser({ lastName: next.trim(), name: composed || user?.email || next.trim() })
  }, [token, patchLocalUser, user?.firstName, user?.email])

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
        toast.success(t('profile:errors.verificationSentDev'))
      } else {
        toast.success(t('profile:errors.verificationSent'))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('profile:errors.resendVerification'))
    } finally {
      setVerifySending(false)
    }
  }, [user?.email, t])

  const saveJobTitle = useCallback(async (next: string) => {
    if (!token) return
    await apiPatchAuth(authRoutes.profile.patch, { job_title: next }, token)
    patchLocalUser({ jobTitle: next || null })
  }, [token, patchLocalUser])

  const [signatureEditorOpen, setSignatureEditorOpen] = useState(false)
  const signatureIdentity = useMemo<SignatureIdentityVars>(
    () => ({
      name: user?.name || user?.email || '',
      firstName: user?.firstName || '',
      lastName: user?.lastName || '',
      email: user?.email || '',
      jobTitle: user?.jobTitle || '',
      company: user?.tenant?.name || '',
      avatarUrl: user?.avatarUrl || user?.signatureUrl || null,
      language: i18n.language?.slice(0, 2) || 'nl',
    }),
    [user?.name, user?.firstName, user?.lastName, user?.email, user?.jobTitle, user?.tenant?.name, user?.avatarUrl, user?.signatureUrl, i18n.language],
  )
  const signaturePreviewHtml = useMemo(
    () => previewSignatureHtml(user?.emailSignatureHtml, signatureIdentity),
    [user?.emailSignatureHtml, signatureIdentity],
  )
  const saveEmailSignature = useCallback(async (signature: string) => {
    if (!token) return
    try {
      await apiPatchAuth(authRoutes.profile.patch, { email_signature_html: signature }, token)
      patchLocalUser({ emailSignatureHtml: signature })
      toast.success(t('profile:signature.saved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('profile:signature.saveError'))
    }
  }, [token, patchLocalUser, t])

  const handleChangePassword = async () => {
    if (newPw !== confirmPw) { setPwError(t('profile:security.passwordMismatch')); return }
    if (!token) return
    if (hasPassword && !currentPw) {
      setPwError(t('profile:security.currentPassword'))
      return
    }
    setPwSaving(true); setPwError(null)
    try {
      await apiPostAuth(
        authRoutes.profile.changePassword,
        { current_password: hasPassword ? currentPw : '', new_password: newPw },
        token,
      )
      setPwSaved(true)
      setPwJustSet(!hasPassword)
      patchLocalUser({ hasPassword: true })
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
      setShowPasswordForm(false)
      setTimeout(() => { setPwSaved(false); setPwJustSet(false) }, 3000)
      void reloadSso()
    } catch (err) {
      setPwError(err instanceof Error ? err.message : t('profile:errors.changePassword'))
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
      setTotpError(err instanceof Error ? err.message : t('profile:errors.totpStart'))
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
      toast.success(t('profile:security.totpEnabled'))
    } catch {
      setTotpError(t('profile:security.totpInvalidCode'))
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
      toast.success(t('profile:security.totpDisabled'))
    } catch (err) {
      setTotpError(err instanceof Error ? err.message : t('profile:errors.totpDisable'))
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
          <div className="flex items-center justify-between gap-3 border-b border-border/60 py-3.5 pr-4">
            <div className="min-w-0">
              <span className="block text-sm font-medium text-text-heading">
                {t('profile:personalInformation.profilePicture')}
              </span>
              <p className="mt-0.5 text-xs text-text-muted">
                {t('profile:personalInformation.photoHint')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => !avatarUploading && avatarInputRef.current?.click()}
              disabled={avatarUploading}
              className="group relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full transition-opacity hover:opacity-80 disabled:cursor-wait"
              title={t('profile:personalInformation.uploadPhoto')}
              aria-label={t('profile:personalInformation.uploadPhoto')}
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
            <div className="flex items-center justify-between gap-3 border-b border-border/60 py-3.5 pr-4">
              <div>
                <p className="text-sm font-medium text-text-heading">{t('profile:verification.title')}</p>
                <p className="text-xs text-text-muted">{t('profile:verification.body')}</p>
              </div>
              <Button size="sm" variant="secondary" disabled={verifySending} onClick={() => void handleResendVerification()}>
                {verifySending ? t('profile:verification.sending') : t('profile:verification.resend')}
              </Button>
            </div>
          ) : null}

          {/* First / last name */}
          <EditableField
            label={t('profile:personalInformation.firstName')}
            value={user?.firstName ?? ''}
            placeholder={t('profile:personalInformation.firstNamePlaceholder')}
            onSave={saveFirstName}
          />
          <EditableField
            label={t('profile:personalInformation.lastName')}
            value={user?.lastName ?? ''}
            placeholder={t('profile:personalInformation.lastNamePlaceholder')}
            onSave={saveLastName}
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

      {/* ── Email signature (personal fallback) ── */}
      <Section title={t('profile:signature.title')} description={t('profile:signature.description')}>
        <Card>
          <div className="flex items-center justify-between gap-4 py-3.5 pr-4">
            <div className="min-w-0 flex-1">
              {!user?.emailSignatureHtml?.trim() && (
                <p className="mb-2 text-xs font-medium text-text-muted">{t('profile:signature.usingDefault')}</p>
              )}
              <div
                className="signature-preview max-h-36 overflow-hidden text-sm [&_img]:inline-block"
                dangerouslySetInnerHTML={{ __html: signaturePreviewHtml }}
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="h-8 shrink-0 rounded-lg px-3 text-xs"
              onClick={() => setSignatureEditorOpen(true)}
            >
              <PenLine size={12} />
              {user?.emailSignatureHtml?.trim() ? t('profile:signature.edit') : t('profile:signature.add')}
            </Button>
          </div>
        </Card>
        <SignatureEditor
          open={signatureEditorOpen}
          onOpenChange={setSignatureEditorOpen}
          initialSignature={user?.emailSignatureHtml ?? ''}
          onSave={(signature) => void saveEmailSignature(signature)}
          mailboxEmail={user?.email ?? ''}
          contextLabel={t('profile:signature.editorContext')}
          identity={signatureIdentity}
        />
        <p className="mt-2 text-xs text-text-muted">
          <Link to="/settings/channels" className="font-medium text-accent hover:underline">
            {t('profile:links.openMailboxSignatures')}
          </Link>
        </p>
      </Section>

      {/* ── Language ── */}
      <Section title={t('profile:language.title')} description={`${t('profile:language.description')} ${t('profile:language.deviceHint')}`}>
        <div className="flex gap-2">
          {(['nl', 'en'] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => {
                applyUiLanguageLocally(i18n, lang)
                if (!token) return
                void persistUiLanguage(token, lang).catch(() => {
                  toast.error(t('profile:language.saveError'))
                })
              }}
              className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                (i18n.resolvedLanguage ?? i18n.language).startsWith(lang)
                  ? 'border-border-light bg-bg-hover text-text-heading'
                  : 'border-border/60 text-text-secondary hover:border-border hover:text-text-primary'
              }`}
            >
              {lang === 'nl' ? t('profile:language.dutch') : t('profile:language.english')}
            </button>
          ))}
        </div>
      </Section>

      {/* ── Start page ── */}
      <Section title={t('profile:landing.title')} description={t('profile:landing.description')}>
        <div className="flex gap-2">
          {([
            { id: 'communication' as const, label: t('profile:landing.communication') },
            { id: 'overview' as const, label: t('profile:landing.overview') },
          ]).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setDefaultLanding(option.id)
                if (!token) return
                void persistDefaultLanding(token, option.id).catch(() => {
                  toast.error(t('profile:landing.saveError'))
                })
              }}
              className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                defaultLanding === option.id
                  ? 'border-border-light bg-bg-hover text-text-heading'
                  : 'border-border/60 text-text-secondary hover:border-border hover:text-text-primary'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </Section>

      {/* ── Appearance ── */}
      <Section title={t('profile:theme.title')} description={t('profile:theme.description')}>
        <div className="panel grid grid-cols-3 gap-2.5 p-3">
          <ThemeOption variant="light" label={t('profile:theme.light')} icon={<Sun size={12} />} active={mode === 'light'} onClick={() => setMode('light')} />
          <ThemeOption variant="dark" label={t('profile:theme.dark')} icon={<Moon size={12} />} active={mode === 'dark'} onClick={() => setMode('dark')} />
          <ThemeOption variant="system" label={t('profile:theme.system')} icon={<LaptopMinimal size={12} />} active={mode === 'system'} onClick={() => setMode('system')} />
        </div>
      </Section>

      {/* ── Security ── */}
      <Section title={t('profile:security.title')} description={t('profile:security.description')}>
        <Card>
          {/* Password */}
          <div className="border-b border-border/60 py-3.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-text-heading">{t('profile:security.passwordTitle')}</p>
                <p className="text-xs text-text-muted">
                  {hasPassword
                    ? t('profile:security.passwordDescription')
                    : t('profile:security.passwordDescriptionSet')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {pwSaved && (
                  <span className="flex items-center gap-1 text-xs text-status-success">
                    <Check size={12} />
                    {pwJustSet
                      ? t('profile:security.passwordSetSuccess')
                      : t('profile:security.passwordSuccess')}
                  </span>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-lg px-3 text-xs"
                  onClick={() => { setShowPasswordForm((v) => !v); setPwError(null) }}
                >
                  <Lock size={12} />
                  {hasPassword
                    ? t('profile:security.changePassword')
                    : t('profile:security.setPassword')}
                </Button>
              </div>
            </div>

            {showPasswordForm && (
              <div className="mt-3 space-y-2.5 rounded-lg border border-border/60 bg-bg-elevated/50 p-3">
                <div className={`grid gap-2.5 ${hasPassword ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                  {(hasPassword
                    ? [
                        { label: t('profile:security.currentPassword'), value: currentPw, set: setCurrentPw },
                        { label: t('profile:security.newPassword'), value: newPw, set: setNewPw },
                        { label: t('profile:security.confirmPassword'), value: confirmPw, set: setConfirmPw },
                      ]
                    : [
                        { label: t('profile:security.newPassword'), value: newPw, set: setNewPw },
                        { label: t('profile:security.confirmPassword'), value: confirmPw, set: setConfirmPw },
                      ]
                  ).map(({ label, value, set }) => (
                    <div key={label} className="space-y-1">
                      <label className="text-xs text-text-muted">{label}</label>
                      <Input
                        type="password"
                        value={value}
                        onChange={(e) => set(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleChangePassword()
                        }}
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
                    disabled={
                      pwSaving
                      || !newPw
                      || !confirmPw
                      || (hasPassword && !currentPw)
                    }
                    onClick={() => void handleChangePassword()}
                  >
                    {pwSaving
                      ? t('profile:personalInformation.saving')
                      : hasPassword
                        ? t('profile:security.changePassword')
                        : t('profile:security.setPassword')}
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

          {/* Connected accounts */}
          <div className="border-b border-border/60 py-3.5">
            <div className="mb-3">
              <p className="text-sm font-medium text-text-heading">{t('profile:security.connectedTitle')}</p>
              <p className="text-xs text-text-muted">{t('profile:security.connectedDescription')}</p>
            </div>
            <div className="space-y-2">
              {(['google', 'microsoft'] as SsoProviderId[]).map((provider) => {
                const row = ssoStatus?.providers.find((p) => p.id === provider)
                const linked = Boolean(row?.linked)
                const configured = row?.configured !== false
                return (
                  <div
                    key={provider}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-heading">
                        {t(`profile:security.${provider}`)}
                      </p>
                      <p className="text-xs text-text-muted">
                        {!configured
                          ? t('profile:security.notConfigured')
                          : linked
                            ? t('profile:security.connected', { email: row?.email || '—' })
                            : t('profile:security.notConnected')}
                      </p>
                    </div>
                    {linked ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-8 rounded-lg px-3 text-xs"
                        disabled={ssoBusy === provider || !configured}
                        onClick={() => void handleSsoDisconnect(provider)}
                      >
                        {t('profile:security.disconnect')}
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-8 rounded-lg px-3 text-xs"
                        disabled={ssoBusy === provider || !configured}
                        onClick={() => void handleSsoConnect(provider)}
                      >
                        {t('profile:security.connect')}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Two-factor authentication */}
          <div className="py-3.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-text-heading">
                  {t('profile:security.totpTitle')}
                </p>
                <p className="text-xs text-text-muted">
                  {user?.totpEnabled
                    ? t('profile:security.totpOnDescription')
                    : t('profile:security.totpOffDescription')}
                </p>
              </div>
              {user?.totpEnabled ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-lg px-3 text-xs"
                  onClick={() => { setShowTotpDisable((v) => !v); setTotpError(null) }}
                >
                  {t('profile:security.totpDisable')}
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
                    : t('profile:security.totpEnable')}
                </Button>
              )}
            </div>

            {totpSetup && !user?.totpEnabled && (
              <div className="mt-3 space-y-3 rounded-lg border border-border/60 bg-bg-elevated/50 p-3">
                <p className="text-xs text-text-secondary">
                  {t('profile:security.totpStep1')}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded-md border border-border/60 bg-bg-input px-2.5 py-1.5 font-mono text-xs text-text-primary">
                    {totpSetup.secret}
                  </code>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-7 rounded-lg px-2.5 text-xs"
                    onClick={() => {
                      void navigator.clipboard.writeText(totpSetup.secret)
                      toast.success(t('common:actions.copied'))
                    }}
                  >
                    {t('common:actions.copy')}
                  </Button>
                  <a
                    href={totpSetup.otpauthUri}
                    className="text-xs font-medium text-accent hover:text-accent-hover"
                  >
                    {t('profile:security.totpOpenApp')}
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
                      : t('profile:security.totpConfirm')}
                  </Button>
                </div>
                {totpError && <p className="text-xs text-status-error">{totpError}</p>}
              </div>
            )}

            {showTotpDisable && user?.totpEnabled && (
              <div className="mt-3 space-y-2.5 rounded-lg border border-border/60 bg-bg-elevated/50 p-3">
                <p className="text-xs text-text-secondary">
                  {t('profile:security.totpDisableConfirm')}
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
                    {t('profile:security.totpDisable')}
                  </Button>
                </div>
                {totpError && <p className="text-xs text-status-error">{totpError}</p>}
              </div>
            )}
          </div>

        </Card>
      </Section>

      {/* ── Session ── */}
      <Section title={t('profile:session.title')} description={t('profile:session.description')}>
        <Card>
          <div className="flex items-center justify-between py-3.5">
            <div>
              <p className="text-sm font-medium text-text-heading">{t('profile:account.signOutTitle')}</p>
              <p className="text-xs text-text-muted">{t('profile:account.signOutDescription')}</p>
            </div>
            <Button variant="secondary" size="sm" className="h-8 rounded-lg px-3 text-xs" onClick={() => void logout()}>
              <LogOut size={12} />
              {t('common:actions.signOut')}
            </Button>
          </div>
        </Card>
      </Section>

      {/* ── Danger zone ── */}
      <Section title={t('profile:dangerZone.title')} description={t('profile:dangerZone.description')}>
        <div className="rounded-lg border border-status-error/30 bg-status-error/[0.03] px-4">
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
        </div>
      </Section>
    </div>
  )
}
