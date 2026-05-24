import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Globe, Image, Loader2, MessageSquare, Sparkles, Upload, X } from 'lucide-react'
import { useWorkspace } from '../context/WorkspaceContext'
import { useAuth } from '../context/AuthContext'
import { authRoutes } from '../api/routes/auth.routes'
import { XANO_AUTH_API } from '../lib/xano'
import { ASSISTENT_DEFAULT_PATH } from '../lib/assistent-settings-path'

// ── Types ──────────────────────────────────────────────────────────────────

type ScanState = 'idle' | 'scanning' | 'done'

type ScannedBrand = {
  name: string
  primaryColor: string
  bgColor: string
  logoUrl?: string
}

const SUPPORTED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] as const
const SUBDOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/

function isSupportedImageFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return SUPPORTED_IMAGE_EXTENSIONS.includes(ext as (typeof SUPPORTED_IMAGE_EXTENSIONS)[number])
}

function validateSubdomain(value: string): string | null {
  const v = value.trim().toLowerCase()
  if (!v) return 'Subdomein is verplicht.'
  if (!SUBDOMAIN_REGEX.test(v)) {
    return 'Gebruik 3-63 tekens: a-z, 0-9, en "-" (niet starten/eindigen met "-").'
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
    img.onerror = () => reject(new Error('SVG kon niet worden geladen'))
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
    if (!ctx) throw new Error('Kan geen canvas context maken')
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('SVG kon niet naar PNG worden omgezet'))
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

// ── Brand Scanner ──────────────────────────────────────────────────────────

function BrandScanner({
  onApply,
}: {
  onApply: (brand: ScannedBrand) => void
}) {
  const [url, setUrl] = useState('')
  const [state, setScanState] = useState<ScanState>('idle')
  const [scanned, setScanned] = useState<ScannedBrand | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const steps = [
    'Website ophalen…',
    'Logo detecteren…',
    'Kleuren analyseren…',
    'Bedrijfsnaam herkennen…',
  ]
  const [stepIndex, setStepIndex] = useState(0)

  const handleScan = () => {
    if (!url.trim()) return
    setScanState('scanning')
    setScanned(null)
    setStepIndex(0)

    let i = 0
    const interval = setInterval(() => {
      i += 1
      if (i < steps.length) setStepIndex(i)
      else clearInterval(interval)
    }, 600)

    timerRef.current = setTimeout(() => {
      clearInterval(interval)
      setScanState('done')
      const hostname = url.replace(/https?:\/\/(www\.)?/, '').split('/')[0]
      const name = hostname.split('.')[0]
      setScanned({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        primaryColor: '#4652f2',
        bgColor: '#13161f',
      })
    }, 2800)
  }

  const handleApply = () => {
    if (scanned) onApply(scanned)
    setScanState('idle')
    setScanned(null)
    setUrl('')
  }

  return (
    <div className="relative rounded-xl border border-accent/30 bg-gradient-to-br from-accent/8 via-accent/4 to-transparent overflow-hidden mb-7">
      {/* Background glow */}
      <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-accent/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full bg-accent/6 blur-2xl pointer-events-none" />

      <div className="relative p-6">
        <div className="flex items-start gap-4 mb-5">
          <div className="w-10 h-10 rounded-xl bg-accent/20 border border-accent/30 flex items-center justify-center shrink-0">
            <Sparkles size={18} className="text-accent" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-text-heading">Huisstijl automatisch detecteren</h3>
            <p className="text-[13px] text-text-secondary mt-0.5 leading-relaxed">
              Vul je website-URL in en Bokito detecteert automatisch je logo, merkkleur en bedrijfsnaam.
            </p>
          </div>
        </div>

        {/* Input row */}
        <div className="flex gap-2.5">
          <div className="relative flex-1">
            <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://jouwbedrijf.nl"
              disabled={state === 'scanning'}
              onKeyDown={(e) => { if (e.key === 'Enter') handleScan() }}
              className="w-full bg-bg-surface/70 border border-border/60 rounded-lg pl-9 pr-3 py-2.5 text-[13px] text-text-primary placeholder-text-muted focus:outline-none focus:border-accent/60 transition-colors disabled:opacity-50"
            />
          </div>
          <button
            type="button"
            onClick={handleScan}
            disabled={state === 'scanning' || !url.trim()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-white text-[13px] font-semibold hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 shadow-[0_4px_14px_rgba(70,82,242,0.35)]"
          >
            {state === 'scanning'
              ? <><Loader2 size={14} className="animate-spin" />Scannen…</>
              : <><Sparkles size={14} />Detecteren</>
            }
          </button>
        </div>

        {/* Scanning steps */}
        {state === 'scanning' && (
          <div className="mt-4 flex flex-col gap-1.5">
            {steps.map((step, i) => (
              <div
                key={step}
                className={`flex items-center gap-2 text-[12px] transition-opacity ${i <= stepIndex ? 'opacity-100' : 'opacity-25'}`}
              >
                {i < stepIndex ? (
                  <CheckCircle2 size={12} className="text-accent shrink-0" />
                ) : i === stepIndex ? (
                  <Loader2 size={12} className="animate-spin text-accent shrink-0" />
                ) : (
                  <span className="w-3 h-3 rounded-full border border-border/50 shrink-0" />
                )}
                <span className={i <= stepIndex ? 'text-text-secondary' : 'text-text-muted'}>{step}</span>
              </div>
            ))}
          </div>
        )}

        {/* Result */}
        {state === 'done' && scanned && (
          <div className="mt-4 flex items-center gap-4 p-4 bg-bg-elevated/80 border border-border/50 rounded-xl">
            <CheckCircle2 size={16} className="text-accent shrink-0" />
            <div className="flex-1 flex items-center gap-4 flex-wrap">
              <span className="text-[13px] font-medium text-text-primary">{scanned.name}</span>
              <div className="flex items-center gap-1.5">
                <span
                  className="w-5 h-5 rounded-md border border-border/60 shrink-0"
                  style={{ background: scanned.primaryColor }}
                />
                <span className="text-[12px] text-text-muted font-mono">{scanned.primaryColor.toUpperCase()}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleApply}
              className="px-3 py-1.5 rounded-lg bg-accent text-white text-[12px] font-semibold hover:bg-accent-hover transition-colors shrink-0"
            >
              Overnemen
            </button>
            <button type="button" onClick={() => { setScanState('idle'); setScanned(null) }}>
              <X size={14} className="text-text-muted hover:text-text-primary transition-colors" />
            </button>
          </div>
        )}
      </div>
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
  const [, setBgColor] = useState('#13161f')
  const [logoSrc, setLogoSrc] = useState<string | null>(null)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [faviconSrc, setFaviconSrc] = useState<string | null>(null)
  const [faviconFile, setFaviconFile] = useState<File | null>(null)
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
  }, [currentWorkspace, user?.tenant?.logo, user?.tenant?.slug])

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!isSupportedImageFile(file)) {
      setSaveError('Ongeldig bestandstype. Gebruik PNG, JPG, JPEG, GIF, WebP of SVG.')
      return
    }
    try {
      setSaveError(null)
      const uploadFile = isSvgFile(file) ? await convertSvgToPng(file) : file
      setLogoFile(uploadFile)
      const reader = new FileReader()
      reader.onload = (ev) => setLogoSrc(ev.target?.result as string)
      reader.readAsDataURL(uploadFile)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'SVG upload mislukt')
    }
  }

  const handleFaviconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!isSupportedImageFile(file)) {
      setSaveError('Ongeldig bestandstype. Gebruik PNG, JPG, JPEG, GIF, WebP of SVG.')
      return
    }
    try {
      setSaveError(null)
      const uploadFile = isSvgFile(file) ? await convertSvgToPng(file) : file
      setFaviconFile(uploadFile)
      const reader = new FileReader()
      reader.onload = (ev) => setFaviconSrc(ev.target?.result as string)
      reader.readAsDataURL(uploadFile)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'SVG upload mislukt')
    }
  }

  const handleApplyBrand = (brand: ScannedBrand) => {
    if (brand.name) setName(brand.name)
    if (brand.primaryColor) setBrandColor(brand.primaryColor)
    if (brand.bgColor) setBgColor(brand.bgColor)
  }

  const handleSave = async () => {
    if (!token || !currentWorkspace?.id) {
      setSaveError('Geen actieve workspace of sessie gevonden.')
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

      const res = await fetch(`${XANO_AUTH_API}${authRoutes.workspaceBranding(currentWorkspace.id)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
        body: form,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Onbekende fout' }))
        throw new Error(typeof err?.message === 'string' ? err.message : `HTTP ${res.status}`)
      }

      await refreshWorkspaces()
      await refreshUser()
      setLogoFile(null)
      setFaviconFile(null)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2500)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Opslaan mislukt')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[896px] py-1 space-y-8">

          {/* ── Auto-detect banner ───────────────────────────────────────── */}
          <BrandScanner onApply={handleApplyBrand} />

          {/* ── Branding ─────────────────────────────────────────────────── */}
          <div>
            <h2 className="text-[15px] font-semibold text-text-heading mb-1">Branding</h2>
            <p className="text-[13px] text-text-secondary mb-4">Beheer de branding van je workspace, inclusief naam, logo en merkkleur.</p>

            <div className="rounded-xl border border-border/55 bg-bg-elevated/30 px-5">
              <SettingRow label="Naam">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-bg-surface/50 border border-border/55 rounded-lg px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:border-accent/55 transition-colors"
                />
              </SettingRow>

              <SettingRow label="Logo" description="Zichtbaar in de portal en widgets. PNG, JPG, JPEG, GIF, WebP of SVG (SVG wordt automatisch geoptimaliseerd voor upload).">
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
                      }}
                      className="px-3 py-1.5 rounded-md border border-border text-[12px] text-text-secondary hover:bg-bg-hover transition-colors"
                    >
                      Verwijderen
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-[12px] text-text-secondary hover:bg-bg-hover transition-colors"
                    >
                      <Upload size={12} />
                      Uploaden
                    </button>
                  )}
                  <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.svg,image/svg+xml" className="hidden" onChange={(e) => { void handleLogoUpload(e) }} />
                </div>
              </SettingRow>

              <SettingRow label="Favicon" description="Browser tab icoon van de tenant. Gebruik PNG, JPG, JPEG, GIF, WebP of SVG (SVG wordt automatisch geoptimaliseerd voor upload).">
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
                      }}
                      className="px-3 py-1.5 rounded-md border border-border text-[12px] text-text-secondary hover:bg-bg-hover transition-colors"
                    >
                      Verwijderen
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => faviconInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-[12px] text-text-secondary hover:bg-bg-hover transition-colors"
                    >
                      <Upload size={12} />
                      Uploaden
                    </button>
                  )}
                  <input ref={faviconInputRef} type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.svg,image/svg+xml" className="hidden" onChange={(e) => { void handleFaviconUpload(e) }} />
                </div>
              </SettingRow>

              <SettingRow label="Merkkleur" description="Primaire accentkleur gebruikt in de portal en widgets.">
                <ColorField value={brandColor} onChange={setBrandColor} />
              </SettingRow>

              <SettingRow label="Workspace subdomein" description="Waar mensen je workspace kunnen bereiken.">
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
                  <span className="px-3 py-2 bg-bg-hover border border-l-0 border-border/55 text-[12px] text-text-muted whitespace-nowrap">.bokito.ai</span>
                  <button
                    type="button"
                    className="ml-2 px-3 py-2 rounded-lg bg-accent text-white text-[12px] font-semibold hover:bg-accent-hover transition-colors shrink-0"
                  >
                    Wijzigen
                  </button>
                </div>
                {subdomainError ? (
                  <p className="mt-2 text-xs text-status-error">{subdomainError}</p>
                ) : null}
              </SettingRow>
            </div>
          </div>

          {/* ── Chat assistent stijl link ─────────────────────────────────── */}
          <button
            type="button"
            onClick={() => navigate(ASSISTENT_DEFAULT_PATH)}
            className="w-full flex items-center gap-4 rounded-xl border border-border/55 bg-bg-elevated/30 px-5 py-4 hover:border-accent/35 hover:bg-bg-hover/40 transition-all group text-left"
          >
            <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
              <MessageSquare size={16} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-text-primary">Chat assistent stijl</p>
              <p className="text-[12px] text-text-muted mt-0.5">Pas kleuren, lettertype en gedrag van de chatwidget aan.</p>
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
              {saving ? <><Loader2 size={14} className="animate-spin" />Opslaan...</> : saved ? <><CheckCircle2 size={14} />Opgeslagen</> : 'Opslaan'}
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}
