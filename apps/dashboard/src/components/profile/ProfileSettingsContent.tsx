import { useRef, useState, useCallback, type KeyboardEvent, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, LaptopMinimal, Lock, Moon, Pencil, ShieldCheck, Sun, Trash2, X } from 'lucide-react'
import { UserAvatar } from '../ui/UserAvatar'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { xanoPatchAuth, xanoPostAuth, XANO_AUTH_API, buildAuthHeaders } from '../../lib/xano'
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
    } finally {
      setSaving(false)
      setEditing(false)
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

export function ProfileSettingsContent({ securityOnly = false }: { securityOnly?: boolean }) {
  const { t, i18n } = useTranslation(['profile', 'common'])
  const { user, token, logout, patchLocalUser } = useAuth()
  const { mode, setMode } = useTheme()

  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)

  const handleAvatarChange = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !token) return
    setAvatarUploading(true)
    try {
      const form = new FormData()
      form.append('avatar', file)
      const headers = buildAuthHeaders(token, false) // no Content-Type — browser sets multipart boundary
      const sendAvatar = async (path: string) => fetch(`${XANO_AUTH_API}${path}`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: form,
      })
      let res = await sendAvatar('/users/me/avatar')
      if (res.status === 404) {
        // Backward compatibility while some environments still use legacy path.
        res = await sendAvatar('/avatar')
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { avatar?: { url?: string; path?: string } }
      const url = data.avatar?.url ?? data.avatar?.path ?? null
      if (url) patchLocalUser({ avatarUrl: url })
    } catch {
      // Silently ignore; user can retry
    } finally {
      setAvatarUploading(false)
      // Reset so the same file can be re-selected
      e.target.value = ''
    }
  }, [token, patchLocalUser])

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
    await xanoPatchAuth('/profile', { name: next }, token)
    patchLocalUser({ name: next })
  }, [token, patchLocalUser])

  const saveEmail = useCallback(async (next: string) => {
    if (!token) return
    await xanoPatchAuth('/profile', { email: next }, token)
    patchLocalUser({ email: next })
  }, [token, patchLocalUser])

  const saveJobTitle = useCallback(async (next: string) => {
    if (!token) return
    await xanoPatchAuth('/profile', { job_title: next }, token)
    patchLocalUser({ jobTitle: next || null })
  }, [token, patchLocalUser])

  const handleChangePassword = async () => {
    if (newPw !== confirmPw) { setPwError(t('profile:security.passwordMismatch')); return }
    if (!token) return
    setPwSaving(true); setPwError(null)
    try {
      await xanoPostAuth('/change-password', { current_password: currentPw, new_password: newPw }, token)
      setPwSaved(true)
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
      setShowPasswordForm(false)
      setTimeout(() => setPwSaved(false), 3000)
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Wijzigen mislukt')
    } finally {
      setPwSaving(false)
    }
  }

  return (
    <div className="space-y-7">

      {/* ── Profile ── */}
      {!securityOnly && <Section title={t('profile:personalInformation.title')} description={t('profile:personalInformation.description')}>
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
      </Section>}

      {/* ── Language ── */}
      {!securityOnly && <Section title={t('profile:language.title')} description={t('profile:language.description')}>
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
      </Section>}

      {/* ── Appearance ── */}
      {!securityOnly && <Section title={t('profile:theme.title')} description={t('profile:theme.description')}>
        <div className="grid grid-cols-3 gap-2.5 rounded-xl border border-border/60 bg-bg-surface/80 p-3">
          <ThemeOption variant="light" label={t('profile:theme.light')} icon={<Sun size={12} />} active={mode === 'light'} onClick={() => setMode('light')} />
          <ThemeOption variant="dark" label={t('profile:theme.dark')} icon={<Moon size={12} />} active={mode === 'dark'} onClick={() => setMode('dark')} />
          <ThemeOption variant="system" label={t('profile:theme.system')} icon={<LaptopMinimal size={12} />} active={mode === 'system'} onClick={() => setMode('system')} />
        </div>
      </Section>}

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

          {/* 2FA */}
          <div className="flex items-center justify-between py-3.5">
            <div>
              <p className="text-sm font-medium text-text-heading">{t('profile:security.twoFactorTitle')}</p>
              <p className="text-xs text-text-muted">{t('profile:security.twoFactorDescription')}</p>
            </div>
            <Button variant="secondary" size="sm" disabled className="h-8 rounded-lg px-3 text-xs">
              <ShieldCheck size={12} />
              {t('profile:security.twoFactorComingSoon')}
            </Button>
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
            <Button variant="destructive" size="sm" className="h-8 rounded-lg px-3 text-xs">
              <Trash2 size={12} />
              {t('common:actions.delete')}
            </Button>
          </div>
        </Card>
      </Section>
    </div>
  )
}
