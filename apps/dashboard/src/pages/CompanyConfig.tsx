import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Image, Loader2, MessageSquare, Upload } from 'lucide-react'
import { useWorkspace } from '../context/WorkspaceContext'
import { useAuth } from '../context/AuthContext'
import { authRoutes } from '../api/routes/auth.routes'
import { AUTH_API_BASE } from '../lib/api'
import { ASSISTANT_DEFAULT_PATH } from '../lib/assistant-settings-path'

const SUPPORTED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] as const
const SUBDOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/

function isSupportedImageFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return SUPPORTED_IMAGE_EXTENSIONS.includes(ext as (typeof SUPPORTED_IMAGE_EXTENSIONS)[number])
}

function validateSubdomain(value: string): string | null {
  const v = value.trim().toLowerCase()
  if (!v) return 'Subdomain is required.'
  if (!SUBDOMAIN_REGEX.test(v)) {
    return 'Use 3-63 characters: a-z, 0-9 and "-" (cannot start or end with "-").'
  }
  return null
}

function isSvgFile(file: File): boolean {
  if (file.type === 'image/svg+xml') return true
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return ext === 'svg'
}

function loadImageFromBlobUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load SVG'))
    img.src = url
  })
}

async function convertSvgToPng(file: File): Promise<File> {
  const blobUrl = URL.createObjectURL(file)
  try {
    const img = await loadImageFromBlobUrl(blobUrl)
    const width = Math.max(Math.round(img.naturalWidth || 256), 16)
    const height = Math.max(Math.round(img.naturalHeight || 256), 16)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not create canvas context')
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Could not convert SVG to PNG'))
          return
        }
        resolve(blob)
      }, 'image/png')
    })
    const basename = file.name.replace(/\.svg$/i, '') || 'upload'
    return new File([pngBlob], `${basename}.png`, { type: 'image/png' })
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function SettingRow({
  label,
  description,
  children,
}: {
  label: string
  description?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[1fr_1.7fr] gap-6 py-4 border-b border-border/40 last:border-0 items-start">
      <div className="pt-0.5">
        <p className="text-[13px] font-medium text-text-primary">{label}</p>
        {description && (
          <p className="text-[12px] text-text-muted mt-0.5 leading-relaxed">{description}</p>
        )}
      </div>
      <div>{children}</div>
    </div>
  )
}

function ColorField({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-2.5">
      <label className="relative cursor-pointer shrink-0">
        <span
          className="block w-9 h-9 rounded-lg border border-border/60 shadow-sm transition-transform hover:scale-105"
          style={{ background: value }}
        />
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
        />
      </label>
      <input
        type="text"
        value={value.toUpperCase()}
        onChange={(e) => onChange(e.target.value)}
        className="w-28 bg-bg-surface/50 border border-border/55 rounded-lg px-3 py-2 text-[13px] text-text-primary font-mono focus:outline-none focus:border-accent/55 transition-colors"
      />
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function CompanyConfig() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const faviconInputRef = useRef<HTMLInputElement>(null)
  const { currentWorkspace, refreshWorkspaces } = useWorkspace()
  const { user, token, refreshUser } = useAuth()
  const [name, setName] = useState('Bokito AI')
  const [subdomain, setSubdomain] = useState('bokito')
  const [brandColor, setBrandColor] = useState('#4652f2')
  const [logoSrc, setLogoSrc] = useState<string | null>(null)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [clearLogo, setClearLogo] = useState(false)
  const [faviconSrc, setFaviconSrc] = useState<string | null>(null)
  const [faviconFile, setFaviconFile] = useState<File | null>(null)
  const [clearFavicon, setClearFavicon] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [subdomainError, setSubdomainError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!currentWorkspace) return
    setName(currentWorkspace.name || 'Bokito AI')
    setSubdomain(currentWorkspace.slug || user?.tenant?.slug || '')
    setBrandColor(currentWorkspace.brand_color || '#4652f2')
    if (currentWorkspace.logo) {
      setLogoSrc(currentWorkspace.logo)
    } else if (user?.tenant?.logo) {
      setLogoSrc(user.tenant.logo)
    }
    setFaviconSrc(currentWorkspace.favicon || null)
    setClearLogo(false)
    setClearFavicon(false)
    setLogoFile(null)
    setFaviconFile(null)
  }, [currentWorkspace, user?.tenant?.logo, user?.tenant?.slug])

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!isSupportedImageFile(file)) {
      setSaveError('Invalid file type. Use PNG, JPG, JPEG, GIF, WebP or SVG.')
      return
    }
    try {
      setSaveError(null)
      const uploadFile = isSvgFile(file) ? await convertSvgToPng(file) : file
      setLogoFile(uploadFile)
      setClearLogo(false)
      const reader = new FileReader()
      reader.onload = (ev) => setLogoSrc(ev.target?.result as string)
      reader.readAsDataURL(uploadFile)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'SVG upload failed')
    }
  }

  const handleFaviconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!isSupportedImageFile(file)) {
      setSaveError('Invalid file type. Use PNG, JPG, JPEG, GIF, WebP or SVG.')
      return
    }
    try {
      setSaveError(null)
      const uploadFile = isSvgFile(file) ? await convertSvgToPng(file) : file
      setFaviconFile(uploadFile)
      setClearFavicon(false)
      const reader = new FileReader()
      reader.onload = (ev) => setFaviconSrc(ev.target?.result as string)
      reader.readAsDataURL(uploadFile)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'SVG upload failed')
    }
  }

  const handleSave = async () => {
    if (!token || !currentWorkspace?.id) {
      setSaveError('No active workspace or session found.')
      return
    }
    const normalizedSubdomain = subdomain.trim().toLowerCase()
    const localSubdomainError = validateSubdomain(normalizedSubdomain)
    if (localSubdomainError) {
      setSubdomainError(localSubdomainError)
      return
    }
    setSaving(true)
    setSaveError(null)
    setSubdomainError(null)
    try {
      const form = new FormData()
      form.append('name', name.trim())
      form.append('subdomain', normalizedSubdomain)
      form.append('brand_color', brandColor.trim())
      if (logoFile) {
        form.append('logo', logoFile)
      }
      if (faviconFile) {
        form.append('favicon', faviconFile)
      }
      if (clearLogo && !logoFile) {
        form.append('clear_logo', 'true')
      }
      if (clearFavicon && !faviconFile) {
        form.append('clear_favicon', 'true')
      }

      const res = await fetch(`${AUTH_API_BASE}${authRoutes.workspaceBranding(currentWorkspace.id)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
        body: form,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Unknown error' }))
        throw new Error(typeof err?.message === 'string' ? err.message : `HTTP ${res.status}`)
      }

      await refreshWorkspaces()
      await refreshUser()
      setLogoFile(null)
      setFaviconFile(null)
      setClearLogo(false)
      setClearFavicon(false)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2500)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[896px] py-1 space-y-8">

          {/* ── Branding ─────────────────────────────────────────────────── */}
          <div>
            <h2 className="text-[15px] font-semibold text-text-heading mb-1">Branding</h2>
            <p className="text-[13px] text-text-secondary mb-4">Manage your workspace branding, including name, logo and brand color.</p>

            <div className="rounded-xl border border-border/55 bg-bg-elevated/30 px-5">
              <SettingRow label="Name">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-bg-surface/50 border border-border/55 rounded-lg px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:border-accent/55 transition-colors"
                />
              </SettingRow>

              <SettingRow label="Logo" description="Shown in the portal and widgets. PNG, JPG, JPEG, GIF, WebP or SVG (SVG is automatically optimized for upload).">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg border border-border/60 bg-bg-surface/60 flex items-center justify-center shrink-0 overflow-hidden">
                    {logoSrc
                      ? <img src={logoSrc} alt="logo" className="w-full h-full object-contain" />
                      : <Image size={16} className="text-text-muted" />
                    }
                  </div>
                  {logoSrc ? (
                    <button
                      type="button"
                      onClick={() => {
                        setLogoSrc(null)
                        setLogoFile(null)
                        setClearLogo(true)
                      }}
                      className="px-3 py-1.5 rounded-md border border-border text-[12px] text-text-secondary hover:bg-bg-hover transition-colors"
                    >
                      Delete
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-[12px] text-text-secondary hover:bg-bg-hover transition-colors"
                    >
                      <Upload size={12} />
                      Upload
                    </button>
                  )}
                  <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.svg,image/svg+xml" className="hidden" onChange={(e) => { void handleLogoUpload(e) }} />
                </div>
              </SettingRow>

              <SettingRow label="Favicon" description="Browser tab icon for the tenant. Use PNG, JPG, JPEG, GIF, WebP or SVG (SVG is automatically optimized for upload).">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg border border-border/60 bg-bg-surface/60 flex items-center justify-center shrink-0 overflow-hidden">
                    {faviconSrc
                      ? <img src={faviconSrc} alt="favicon" className="w-5 h-5 object-contain" />
                      : <Image size={16} className="text-text-muted" />
                    }
                  </div>
                  {faviconSrc ? (
                    <button
                      type="button"
                      onClick={() => {
                        setFaviconSrc(null)
                        setFaviconFile(null)
                        setClearFavicon(true)
                      }}
                      className="px-3 py-1.5 rounded-md border border-border text-[12px] text-text-secondary hover:bg-bg-hover transition-colors"
                    >
                      Delete
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => faviconInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-[12px] text-text-secondary hover:bg-bg-hover transition-colors"
                    >
                      <Upload size={12} />
                      Upload
                    </button>
                  )}
                  <input ref={faviconInputRef} type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.svg,image/svg+xml" className="hidden" onChange={(e) => { void handleFaviconUpload(e) }} />
                </div>
              </SettingRow>

              <SettingRow label="Brand color" description="Primary accent color used in the portal and widgets.">
                <ColorField value={brandColor} onChange={setBrandColor} />
              </SettingRow>

              <SettingRow label="Workspace subdomain" description="Where people can reach your workspace.">
                <div className="flex items-center">
                  <input
                    type="text"
                    value={subdomain}
                    onChange={(e) => {
                      const next = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')
                      setSubdomain(next)
                      if (subdomainError) setSubdomainError(validateSubdomain(next))
                    }}
                    className="flex-1 bg-bg-surface/50 border border-border/55 rounded-l-lg px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:border-accent/55 transition-colors"
                  />
                  <span className="px-3 py-2 bg-bg-hover border border-l-0 border-border/55 rounded-r-lg text-[12px] text-text-muted whitespace-nowrap">.bokito.ai</span>
                </div>
                {subdomainError ? (
                  <p className="mt-2 text-xs text-status-error">{subdomainError}</p>
                ) : null}
              </SettingRow>
            </div>
          </div>

          {/* ── Chat assistant style link ─────────────────────────────────── */}
          <button
            type="button"
            onClick={() => navigate(ASSISTANT_DEFAULT_PATH)}
            className="w-full flex items-center gap-4 rounded-xl border border-border/55 bg-bg-elevated/30 px-5 py-4 hover:border-accent/35 hover:bg-bg-hover/40 transition-all group text-left"
          >
            <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
              <MessageSquare size={16} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-text-primary">Chat assistant style</p>
              <p className="text-[12px] text-text-muted mt-0.5">Customize colors, typography and behavior of the chat widget.</p>
            </div>
            <ArrowRight size={15} className="text-text-muted group-hover:text-accent transition-colors shrink-0" />
          </button>

          {/* ── Save ──────────────────────────────────────────────────────── */}
          <div className="flex justify-end pb-6">
            {saveError ? (
              <p className="mr-4 self-center text-xs text-status-error">{saveError}</p>
            ) : null}
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className={`inline-flex items-center gap-2 px-5 py-2 rounded-lg text-[13px] font-semibold transition-all ${
                saved
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-accent text-white hover:bg-accent-hover shadow-[0_4px_14px_rgba(70,82,242,0.3)]'
              }`}
            >
              {saving ? <><Loader2 size={14} className="animate-spin" />Saving...</> : saved ? <><CheckCircle2 size={14} />Saved</> : 'Save'}
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}
