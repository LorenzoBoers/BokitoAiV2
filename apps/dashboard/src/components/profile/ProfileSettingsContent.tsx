import { useRef, useState, useCallback, useEffect, useMemo, type KeyboardEvent, type ChangeEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check, LaptopMinimal, Lock, LogOut, Moon, Pencil, PenLine, ShieldCheck, Sun, Trash2, X } from 'lucide-react'
import { Switch } from '../ui/switch'
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
import { GoogleLogo, MicrosoftLogo } from '../auth/provider-logos'
import { describeSsoError } from '../auth/sso-errors'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { useConfirm } from '../ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Tip } from '../ui/Tip'
import { TotpQrCode } from './TotpQrCode'
import SignatureEditor from '../inbox/SignatureEditor'
import { previewSignatureHtml, type SignatureIdentityVars } from '../../lib/default-signature'
import { applyUiLanguageLocally, persistUiLanguage } from '../../lib/language-preference'
import {
  fetchDefaultLanding,
  persistDefaultLanding,
  readCachedDefaultLanding,
  type DefaultLanding,
} from '../../lib/landing-preference'
import {
  fetchCloseEmailOnSend,
  persistCloseEmailOnSend,
  readCachedCloseEmailOnSend,
} from '../../lib/email-close-pref'
import { prepareProfilePhoto, PrepareProfilePhotoError, assertProfilePhotoFile, type ProfilePhotoCrop } from '../../lib/prepare-profile-photo'
import { AvatarCropDialog } from './AvatarCropDialog'

// ── inline editable field ────────────────────────────────────────────────────

function EditableField({
  label,
  value,
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
    setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
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
          <button
            type="button"
            onClick={startEdit}
            className={`max-w-[16rem] truncate text-right text-sm ${value ? 'text-text-primary' : 'text-text-muted'}`}
          >
            {value || t('personalInformation.emptyValue')}
          </button>
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
      aria-pressed={active}
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
  const [closeEmailOnSend, setCloseEmailOnSend] = useState(() => readCachedCloseEmailOnSend())

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void fetchDefaultLanding(token).then((landing) => {
      if (!cancelled) setDefaultLanding(landing)
    })
    void fetchCloseEmailOnSend(token).then((enabled) => {
      if (!cancelled) setCloseEmailOnSend(enabled)
    })
    return () => {
      cancelled = true
    }
  }, [token])

  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarRemoving, setAvatarRemoving] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [verifySending, setVerifySending] = useState(false)

  const uploadPreparedAvatar = useCallback(async (prepared: File) => {
    if (!token) return
    const form = new FormData()
    form.append('avatar', prepared)
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
    if (!res.ok) {
      let detail = `HTTP ${res.status}`
      try {
        const body = (await res.json()) as { detail?: unknown }
        if (typeof body.detail === 'string' && body.detail.trim()) detail = body.detail.trim()
      } catch {
        /* ignore */
      }
      throw new Error(detail)
    }
    const data = await res.json() as { avatar?: { url?: string; path?: string } }
    const url = data.avatar?.url ?? data.avatar?.path ?? null
    if (url) {
      patchLocalUser({ avatarUrl: url })
      toast.success(t('profile:personalInformation.photoUpdated'))
    }
  }, [token, patchLocalUser, t])

  const handleAvatarChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !token) return
    try {
      assertProfilePhotoFile(file)
    } catch (prepErr) {
      if (prepErr instanceof PrepareProfilePhotoError) {
        const key =
          prepErr.code === 'too_large'
            ? 'profile:errors.uploadAvatarTooLarge'
            : prepErr.code === 'unsupported' || prepErr.code === 'decode'
              ? 'profile:errors.uploadAvatarUnsupported'
              : 'profile:errors.uploadAvatar'
        toast.error(t(key))
        return
      }
      throw prepErr
    }
    setCropFile(file)
  }, [token, t])

  const handleAvatarCrop = useCallback(async (crop: ProfilePhotoCrop) => {
    const file = cropFile
    if (!file || !token) return
    setAvatarUploading(true)
    try {
      const prepared = await prepareProfilePhoto(file, crop)
      await uploadPreparedAvatar(prepared)
      setCropFile(null)
    } catch (prepErr) {
      if (prepErr instanceof PrepareProfilePhotoError) {
        const key =
          prepErr.code === 'too_large'
            ? 'profile:errors.uploadAvatarTooLarge'
            : prepErr.code === 'unsupported' || prepErr.code === 'decode'
              ? 'profile:errors.uploadAvatarUnsupported'
              : 'profile:errors.uploadAvatar'
        toast.error(t(key))
        return
      }
      toast.error(
        prepErr instanceof Error
          ? t('profile:errors.uploadAvatarDetail', { detail: prepErr.message })
          : t('profile:errors.uploadAvatar'),
      )
    } finally {
      setAvatarUploading(false)
    }
  }, [cropFile, token, t, uploadPreparedAvatar])

  const handleAvatarRemove = useCallback(async () => {
    if (!token || avatarRemoving || !user?.avatarUrl) return
    setAvatarRemoving(true)
    try {
      const headers = buildAuthHeaders(token, true)
      const res = await fetch(`${AUTH_API_BASE}${authRoutes.users.meAvatar}`, {
        method: 'DELETE',
        headers,
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      patchLocalUser({ avatarUrl: null })
      toast.success(t('profile:personalInformation.photoRemoved'))
    } catch {
      toast.error(t('profile:errors.removeAvatar'))
    } finally {
      setAvatarRemoving(false)
    }
  }, [token, avatarRemoving, user?.avatarUrl, patchLocalUser, t])

  // Account deletion
  const [deleting, setDeleting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const deletePasswordRef = useRef<HTMLInputElement>(null)
  const closeDelete = () => {
    if (deleting) return
    setDeleteOpen(false)
    setDeletePassword('')
    setDeleteError(null)
  }
  const handleDeleteAccount = useCallback(async () => {
    if (!token || deleting || !deletePassword.trim()) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await apiPostAuth(authRoutes.profile.deleteAccount, { password: deletePassword }, token)
      await logout()
      window.location.assign('/login')
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : t('profile:errors.deleteAccount'))
      setDeleting(false)
    }
  }, [token, deleting, deletePassword, t, logout])

  // Password form
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwTotp, setPwTotp] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSaved, setPwSaved] = useState(false)
  const [pwJustSet, setPwJustSet] = useState(false)
  const hasPassword = user?.hasPassword === true
  const totpRequired = Boolean(user?.totpEnabled)

  const closePasswordForm = () => {
    setShowPasswordForm(false)
    setCurrentPw('')
    setNewPw('')
    setConfirmPw('')
    setPwTotp('')
    setPwError(null)
  }

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
    if (newPw.length < 8) { setPwError(t('profile:security.passwordTooShort')); return }
    if (newPw !== confirmPw) { setPwError(t('profile:security.passwordMismatch')); return }
    if (!token) return
    if (hasPassword && !currentPw) {
      setPwError(t('profile:security.currentPassword'))
      return
    }
    if (totpRequired && pwTotp.replace(/\D/g, '').length !== 6) {
      setPwError(t('profile:security.totpInvalidCode'))
      return
    }
    setPwSaving(true); setPwError(null)
    try {
      await apiPostAuth(
        authRoutes.profile.changePassword,
        {
          current_password: hasPassword ? currentPw : '',
          new_password: newPw,
          totp_code: totpRequired ? pwTotp.replace(/\D/g, '') : '',
        },
        token,
      )
      setPwSaved(true)
      setPwJustSet(!hasPassword)
      patchLocalUser({ hasPassword: true })
      closePasswordForm()
      setTimeout(() => { setPwSaved(false); setPwJustSet(false) }, 3000)
      void reloadSso()
    } catch (err) {
      const raw = err instanceof Error ? err.message : ''
      if (raw === 'Invalid verification code') {
        setPwError(t('profile:security.totpInvalidCode'))
      } else if (raw === 'Current password is incorrect') {
        setPwError(t('profile:security.currentPasswordWrong'))
      } else {
        setPwError(raw || t('profile:errors.changePassword'))
      }
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

  const closeTotpSetup = () => {
    setTotpSetup(null)
    setTotpEnrollCode('')
    setTotpError(null)
  }

  const closeTotpDisable = () => {
    setShowTotpDisable(false)
    setTotpDisablePw('')
    setTotpError(null)
  }

  const startTotpSetup = async () => {
    if (!token) return
    setTotpBusy(true)
    setTotpError(null)
    try {
      const data = await apiPostAuth<{ secret: string; otpauth_uri: string }>(
        authRoutes.twoFactor.setup, {}, token,
      )
      setTotpSetup({ secret: data.secret, otpauthUri: data.otpauth_uri })
      setTotpEnrollCode('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('profile:errors.totpStart'))
    } finally {
      setTotpBusy(false)
    }
  }

  const confirmTotpEnable = async () => {
    if (!token) return
    setTotpBusy(true)
    setTotpError(null)
    try {
      await apiPostAuth(authRoutes.twoFactor.enable, { code: totpEnrollCode }, token)
      patchLocalUser({ totpEnabled: true })
      closeTotpSetup()
      toast.success(t('profile:security.totpEnabled'))
    } catch {
      setTotpError(t('profile:security.totpInvalidCode'))
    } finally {
      setTotpBusy(false)
    }
  }

  const disableTotp = async () => {
    if (!token) return
    setTotpBusy(true)
    setTotpError(null)
    try {
      await apiPostAuth(authRoutes.twoFactor.disable, { password: totpDisablePw }, token)
      patchLocalUser({ totpEnabled: false })
      closeTotpDisable()
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
            <div className="flex shrink-0 items-center gap-2">
              {user?.avatarUrl ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={avatarUploading || avatarRemoving}
                  onClick={() => void handleAvatarRemove()}
                >
                  {avatarRemoving
                    ? t('profile:personalInformation.removingPhoto')
                    : t('profile:personalInformation.removePhoto')}
                </Button>
              ) : null}
              <button
                type="button"
                onClick={() => !avatarUploading && !avatarRemoving && avatarInputRef.current?.click()}
                disabled={avatarUploading || avatarRemoving}
                className="group relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full transition-opacity hover:opacity-80 disabled:cursor-wait"
                title={t('profile:personalInformation.uploadPhoto')}
                aria-label={t('profile:personalInformation.uploadPhoto')}
              >
                <UserAvatar name={user?.name ?? '?'} email={user?.email ?? ''} avatarUrl={user?.avatarUrl} size={48} />
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  {avatarUploading
                    ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    : <Pencil size={14} className="text-white" />}
                </span>
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif"
                className="hidden"
                onChange={handleAvatarChange}
              />
              <AvatarCropDialog
                file={cropFile}
                busy={avatarUploading}
                onClose={() => {
                  if (!avatarUploading) setCropFile(null)
                }}
                onConfirm={(crop) => void handleAvatarCrop(crop)}
              />
            </div>
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

      {/* ── Email: signature and close-on-send ── */}
      <Section title={t('profile:signature.title')} description={t('profile:signature.description')}>
        <Card>
          <div className="flex items-center justify-between gap-4 border-b border-border/60 py-3.5 pr-4">
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
          <div className="flex items-center justify-between gap-4 py-3.5 pr-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-text-heading">{t('profile:emailClose.label')}</p>
              <p className="text-xs text-text-muted">{t('profile:emailClose.hint')}</p>
            </div>
            <Switch
              checked={closeEmailOnSend}
              aria-label={t('profile:emailClose.label')}
              onCheckedChange={(checked) => {
                setCloseEmailOnSend(checked)
                if (!token) return
                void persistCloseEmailOnSend(token, checked).catch(() => {
                  setCloseEmailOnSend(!checked)
                  toast.error(t('profile:emailClose.saveError'))
                })
              }}
            />
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
              aria-pressed={(i18n.resolvedLanguage ?? i18n.language).startsWith(lang)}
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
              aria-pressed={defaultLanding === option.id}
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
                  onClick={() => { setShowPasswordForm(true); setPwError(null) }}
                >
                  <Lock size={12} />
                  {hasPassword
                    ? t('profile:security.changePassword')
                    : t('profile:security.setPassword')}
                </Button>
              </div>
            </div>
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
                const linkedEmail = (row?.email || '').trim()
                const accountHasPassword = ssoStatus?.has_password ?? hasPassword
                const otherLinked = (ssoStatus?.providers ?? []).some(
                  (p) => p.id !== provider && p.linked,
                )
                // Mirror API: do not drop the only remaining sign-in method.
                const canUnlink = accountHasPassword || otherLinked
                const Logo = provider === 'google' ? GoogleLogo : MicrosoftLogo
                const disconnectDisabled = ssoBusy === provider || !configured || !canUnlink
                const disconnectButton = (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg px-3 text-xs text-status-error hover:bg-status-error/10 hover:text-status-error"
                    disabled={disconnectDisabled}
                    onClick={() => void handleSsoDisconnect(provider)}
                  >
                    {t('profile:security.disconnect')}
                  </Button>
                )
                return (
                  <div
                    key={provider}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2.5"
                    data-testid={`sso-row-${provider}`}
                    data-linked={linked ? 'true' : 'false'}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-bg-surface">
                        <Logo size={18} />
                      </span>
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-text-heading">
                            {t(`profile:security.${provider}`)}
                          </p>
                          {!configured ? (
                            <Badge variant="warning" size="sm" dot>
                              {t('profile:security.notConfigured')}
                            </Badge>
                          ) : linked ? (
                            <Badge variant="success" size="sm" dot>
                              {t('profile:security.connectedBadge')}
                            </Badge>
                          ) : (
                            <Badge variant="neutral" size="sm" dot>
                              {t('profile:security.notConnectedBadge')}
                            </Badge>
                          )}
                        </div>
                        {linked && linkedEmail ? (
                          <p className="truncate text-xs text-text-secondary" title={linkedEmail}>
                            {linkedEmail}
                          </p>
                        ) : (
                          <p className="text-xs text-text-muted">
                            {configured
                              ? t('profile:security.connectHint')
                              : t('profile:security.notConfiguredHint')}
                          </p>
                        )}
                      </div>
                    </div>
                    {linked ? (
                      !canUnlink && configured ? (
                        <Tip label={t('profile:security.unlinkBlocked')}>
                          <span className="inline-flex">{disconnectButton}</span>
                        </Tip>
                      ) : (
                        disconnectButton
                      )
                    ) : (
                      <Button
                        variant="default"
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
            <div className="mb-3">
              <p className="text-sm font-medium text-text-heading">{t('profile:security.totpTitle')}</p>
              <p className="text-xs text-text-muted">
                {user?.totpEnabled
                  ? t('profile:security.totpOnDescription')
                  : t('profile:security.totpOffDescription')}
              </p>
            </div>
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2.5"
              data-testid="totp-row"
              data-enabled={user?.totpEnabled ? 'true' : 'false'}
            >
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className={
                    user?.totpEnabled
                      ? 'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-status-success/30 bg-status-success/10 text-status-success'
                      : 'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-bg-surface text-text-muted'
                  }
                >
                  <ShieldCheck size={18} aria-hidden />
                </span>
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-text-heading">
                      {t('profile:security.totpMethod')}
                    </p>
                    {user?.totpEnabled ? (
                      <Badge variant="success" size="sm" dot>
                        {t('profile:security.totpOnBadge')}
                      </Badge>
                    ) : (
                      <Badge variant="neutral" size="sm" dot>
                        {t('profile:security.totpOffBadge')}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-text-muted">
                    {user?.totpEnabled
                      ? t('profile:security.totpOnHint')
                      : t('profile:security.totpOffHint')}
                  </p>
                </div>
              </div>
              {user?.totpEnabled ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 rounded-lg px-3 text-xs text-status-error hover:bg-status-error/10 hover:text-status-error"
                  onClick={() => { setShowTotpDisable(true); setTotpError(null) }}
                >
                  {t('profile:security.totpDisable')}
                </Button>
              ) : (
                <Button
                  variant="default"
                  size="sm"
                  className="h-8 shrink-0 rounded-lg px-3 text-xs"
                  disabled={totpBusy}
                  onClick={() => void startTotpSetup()}
                >
                  {t('profile:security.totpEnable')}
                </Button>
              )}
            </div>
          </div>

        </Card>
      </Section>

      <Dialog open={showPasswordForm} onOpenChange={(open) => { if (!open) closePasswordForm() }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {hasPassword
                ? t('profile:security.changePassword')
                : t('profile:security.setPassword')}
            </DialogTitle>
            <DialogDescription>
              {hasPassword
                ? totpRequired
                  ? t('profile:security.passwordModalDescriptionMfa')
                  : t('profile:security.passwordModalDescription')
                : t('profile:security.passwordModalDescriptionSet')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {hasPassword ? (
              <div className="space-y-1">
                <label className="text-xs text-text-muted" htmlFor="pw-current">
                  {t('profile:security.currentPassword')}
                </label>
                <Input
                  id="pw-current"
                  type="password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  className="h-9 rounded-lg text-sm"
                  autoComplete="current-password"
                  autoFocus
                />
              </div>
            ) : null}
            <div className="space-y-1">
              <label className="text-xs text-text-muted" htmlFor="pw-new">
                {t('profile:security.newPassword')}
              </label>
              <Input
                id="pw-new"
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                className="h-9 rounded-lg text-sm"
                autoComplete="new-password"
                autoFocus={!hasPassword}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-text-muted" htmlFor="pw-confirm">
                {t('profile:security.confirmPassword')}
              </label>
              <Input
                id="pw-confirm"
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !totpRequired) void handleChangePassword()
                }}
                className="h-9 rounded-lg text-sm"
                autoComplete="new-password"
              />
            </div>
            {totpRequired ? (
              <div className="space-y-1">
                <label className="text-xs text-text-muted" htmlFor="pw-totp">
                  {t('profile:security.totpCode')}
                </label>
                <Input
                  id="pw-totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={pwTotp}
                  onChange={(e) => setPwTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleChangePassword()
                  }}
                  className="h-9 rounded-lg text-center font-mono text-sm tracking-[0.3em]"
                  placeholder={t('profile:security.totpCodePlaceholder')}
                />
                <p className="text-xs text-text-muted">{t('profile:security.passwordTotpHint')}</p>
              </div>
            ) : (
              <p className="text-xs text-text-muted">{t('profile:security.passwordHint')}</p>
            )}
            {pwError ? <p className="text-xs text-status-error">{pwError}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={closePasswordForm}>
              {t('profile:security.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={
                pwSaving
                || newPw.length < 8
                || newPw !== confirmPw
                || (hasPassword && !currentPw)
                || (totpRequired && pwTotp.length !== 6)
              }
              onClick={() => void handleChangePassword()}
            >
              {pwSaving
                ? t('profile:personalInformation.saving')
                : hasPassword
                  ? t('profile:security.changePassword')
                  : t('profile:security.setPassword')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(totpSetup) && !user?.totpEnabled}
        onOpenChange={(open) => { if (!open) closeTotpSetup() }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('profile:security.totpTitle')}</DialogTitle>
            <DialogDescription>{t('profile:security.totpStep1')}</DialogDescription>
          </DialogHeader>
          {totpSetup ? (
            <div className="space-y-4">
              <div className="flex justify-center">
                <TotpQrCode
                  value={totpSetup.otpauthUri}
                  label={t('profile:security.totpQrLabel')}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-text-secondary">
                  {t('profile:security.totpManualKey')}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-md border border-border/60 bg-bg-input px-2.5 py-1.5 font-mono text-xs text-text-primary">
                    {totpSetup.secret}
                  </code>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-7 shrink-0 rounded-lg px-2.5 text-xs"
                    onClick={() => {
                      void navigator.clipboard.writeText(totpSetup.secret)
                      toast.success(t('common:actions.copied'))
                    }}
                  >
                    {t('common:actions.copy')}
                  </Button>
                </div>
                <a
                  href={totpSetup.otpauthUri}
                  className="inline-block text-xs font-medium text-accent hover:text-accent-hover"
                >
                  {t('profile:security.totpOpenApp')}
                </a>
              </div>
              <div>
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  value={totpEnrollCode}
                  onChange={(e) => setTotpEnrollCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="h-9 w-36 rounded-lg text-center font-mono text-sm tracking-[0.25em]"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && totpEnrollCode.length === 6 && !totpBusy) {
                      void confirmTotpEnable()
                    }
                  }}
                />
              </div>
              {totpError ? <p className="text-xs text-status-error">{totpError}</p> : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={closeTotpSetup}>
              {t('profile:security.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={totpBusy || totpEnrollCode.length !== 6}
              onClick={() => void confirmTotpEnable()}
            >
              {totpBusy
                ? t('profile:personalInformation.saving')
                : t('profile:security.totpConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showTotpDisable && Boolean(user?.totpEnabled)} onOpenChange={(open) => { if (!open) closeTotpDisable() }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('profile:security.totpDisable')}</DialogTitle>
            <DialogDescription>{t('profile:security.totpDisableConfirm')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="password"
              value={totpDisablePw}
              onChange={(e) => setTotpDisablePw(e.target.value)}
              className="h-9 rounded-lg text-sm"
              autoComplete="current-password"
              autoFocus
            />
            {totpError ? <p className="text-xs text-status-error">{totpError}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={closeTotpDisable}>
              {t('profile:security.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={totpBusy || !totpDisablePw}
              onClick={() => void disableTotp()}
            >
              {t('profile:security.totpDisable')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              onClick={() => {
                setDeletePassword('')
                setDeleteError(null)
                setDeleteOpen(true)
                setTimeout(() => deletePasswordRef.current?.focus(), 0)
              }}
              className="h-8 rounded-lg px-3 text-xs"
            >
              <Trash2 size={12} />
              {deleting ? t('profile:account.deleting') : t('common:actions.delete')}
            </Button>
          </div>
        </div>
      </Section>
      {deleteOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDelete()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') closeDelete()
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            className="w-full max-w-md rounded-lg border border-border bg-bg-elevated p-5 shadow-lg"
          >
            <h3 id="delete-account-title" className="text-base font-semibold text-text-heading">
              {t('profile:account.deleteTitle')}
            </h3>
            <p className="mt-1 text-sm text-text-secondary">{t('profile:account.deleteConfirm')}</p>
            <label className="mt-4 block text-sm font-medium text-text-heading" htmlFor="delete-account-password">
              {t('profile:account.deletePasswordLabel')}
            </label>
            <Input
              id="delete-account-password"
              ref={deletePasswordRef}
              type="password"
              value={deletePassword}
              autoComplete="current-password"
              onChange={(event) => setDeletePassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleDeleteAccount()
                if (event.key === 'Escape') closeDelete()
              }}
              className="mt-1.5"
            />
            {deleteError ? <p className="mt-2 text-xs text-status-error">{deleteError}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={closeDelete} disabled={deleting}>
                {t('profile:security.cancel')}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleting || !deletePassword.trim()}
                onClick={() => void handleDeleteAccount()}
              >
                {deleting ? t('profile:account.deleting') : t('profile:account.deleteTitle')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
