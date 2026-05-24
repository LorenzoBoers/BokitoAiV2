import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import {
  ChevronDown,
  Check,
  Copy,
  Globe,
  Image,
  Loader2,
  Moon,
  Palette,
  Sun,
  Type,
  Upload,
  Users,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Switch } from '../components/ui/switch'
import { useWorkspace } from '../context/WorkspaceContext'
import { useAuth } from '../context/AuthContext'
import { authRoutes } from '../api/routes/auth.routes'
import { XANO_AUTH_API } from '../lib/xano'
import {
  CHAT_WIDGET_SCRIPT_PATH_EXTERNAL,
  CHAT_WIDGET_SCRIPT_PATH_INTERNAL,
  DASHBOARD_CHAT_AGENT_SLUG,
  livechatWidgetHostedScriptUrl,
  livechatWidgetHttpOrigin,
} from '../lib/api.config'
import {
  DEFAULT_MESSENGER_APPEARANCE,
  appearanceToBrandingJson,
  messengerAppearanceEquals,
  serializeAppearanceForWidgetPreview,
  type MessengerAppearance,
} from '../lib/messenger-appearance'
import {
  ASSISTENT_DEFAULT_PATH,
  assistentSettingsPath,
  parseAssistentSettingsParams,
  type AssistentAudience,
  type AssistentSection,
} from '../lib/assistent-settings-path'
import { cn } from '../lib/utils'
import { toast } from 'sonner'

type CustomizationPanel = 'content' | 'styling'
type PreviewTheme = 'light' | 'dark'
type AgentModelSource = 'bokito_ai' | 'custom'
type AgentReplyLength = 'concise' | 'balanced' | 'detailed'
function ColorField({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-2.5">
      <label className="relative shrink-0 cursor-pointer">
        <span
          className="block h-9 w-9 rounded-lg border border-border/60 shadow-sm transition-transform hover:scale-105"
          style={{ background: value }}
        />
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      <input
        type="text"
        value={value.toUpperCase()}
        onChange={(e) => onChange(e.target.value)}
        className="w-28 rounded-lg border border-border/55 bg-bg-surface/50 px-3 py-2 font-mono text-[13px] text-text-primary focus:border-accent/55 focus:outline-none"
      />
    </div>
  )
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
  stretch,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; icon?: ReactNode }[]
  className?: string
  size?: 'sm' | 'md'
  stretch?: boolean
}) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'
  return (
    <div
      role="tablist"
      className={cn(
        'max-w-full gap-0.5 rounded-xl border border-border/55 bg-bg-input/40 p-1 dark:bg-bg-input/55',
        stretch ? 'flex w-full' : 'inline-flex flex-wrap',
        className,
      )}
    >
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative z-10 inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
              stretch && 'min-w-0 flex-1',
              pad,
              active
                ? 'bg-bg-surface text-text-heading shadow-sm ring-1 ring-border/40'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            {opt.icon ? <span className="hidden sm:inline">{opt.icon}</span> : null}
            <span className="whitespace-nowrap">{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function FoldableSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-border/60 bg-bg-input/35 dark:bg-bg-input/25">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-bg-hover/40"
      >
        <span className="text-[15px] font-medium text-text-heading">{title}</span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-text-muted transition-transform duration-200', open && 'rotate-180')}
        />
      </button>
      {open ? <div className="border-t border-border/55 px-4 pb-4 pt-1">{children}</div> : null}
    </div>
  )
}

function MessengerSettingsContent({
  audience,
  section,
}: {
  audience: AssistentAudience
  section: AssistentSection
}) {
  const navigate = useNavigate()
  const { currentWorkspace, refreshWorkspaces } = useWorkspace()
  const { token } = useAuth()
  const previewHostRef = useRef<HTMLDivElement>(null)
  const previewWidgetRef = useRef<HTMLElement | null>(null)

  const [customizationPanel, setCustomizationPanel] = useState<CustomizationPanel>('content')
  const [previewTheme, setPreviewTheme] = useState<PreviewTheme>('dark')

  const [draft, setDraft] = useState<MessengerAppearance>(DEFAULT_MESSENGER_APPEARANCE)
  const [saved, setSaved] = useState<MessengerAppearance>(DEFAULT_MESSENGER_APPEARANCE)
  const [widgetFaviconFile, setWidgetFaviconFile] = useState<File | null>(null)
  const [faviconPreviewUrl, setFaviconPreviewUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState(false)

  /** Agent tab: frontend-only until API exists */
  const [agentModelSource, setAgentModelSource] = useState<AgentModelSource>('bokito_ai')
  const [customModelId, setCustomModelId] = useState('')
  const [customTemperature, setCustomTemperature] = useState('0.7')
  const [streamResponses, setStreamResponses] = useState(true)
  const [allowToolUse, setAllowToolUse] = useState(true)
  const [includeVisitorPageContext, setIncludeVisitorPageContext] = useState(false)
  const [handoffToHuman, setHandoffToHuman] = useState(true)
  const [maxContextTurns, setMaxContextTurns] = useState('12')
  const [replyLength, setReplyLength] = useState<AgentReplyLength>('balanced')
  const [installSnippetCopied, setInstallSnippetCopied] = useState(false)

  const previewPanelActive = section === 'customization' || section === 'installation'

  const embedNavOptions: { value: AssistentAudience; label: string; icon: ReactNode }[] = [
    { value: 'internal', label: 'Intern', icon: <Users className="h-3.5 w-3.5 opacity-70" /> },
    { value: 'external', label: 'Extern', icon: <Globe className="h-3.5 w-3.5 opacity-70" /> },
  ]

  const installationHtmlSnippet = useMemo(() => {
    const apiOrigin = livechatWidgetHttpOrigin()
    const slug = DASHBOARD_CHAT_AGENT_SLUG
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const xanoInternal = livechatWidgetHostedScriptUrl('internal')
    const xanoExternal = livechatWidgetHostedScriptUrl('external')

    if (audience === 'internal') {
      return (
        `<!-- Bokito team-widget: ingelogde gebruikers met rechten (zelfde host als portal) -->\n` +
        `<script\n` +
        `  src="${origin}${CHAT_WIDGET_SCRIPT_PATH_INTERNAL}"\n` +
        `  data-bokito-chat-widget\n` +
        `  data-agent-slug="${slug}"\n` +
        `  data-api-url="${apiOrigin}"\n` +
        `  data-auth-mode="optional"\n` +
        `  defer\n` +
        `></script>\n` +
        `\n` +
        `<!-- Alternatief: laad dezelfde team-widget rechtstreeks vanaf Xano (vereist werkende route script/internal) -->\n` +
        `<!--\n` +
        `<script\n` +
        `  src="${xanoInternal}"\n` +
        `  data-agent-slug="${slug}"\n` +
        `  data-api-url="${apiOrigin}"\n` +
        `  data-auth-mode="optional"\n` +
        `  defer\n` +
        `></script>\n` +
        `-->`
      )
    }
    return (
      `<!-- Bokito publieke widget: anonieme websitebezoekers (zelfde host als portal) -->\n` +
      `<script\n` +
      `  src="${origin}${CHAT_WIDGET_SCRIPT_PATH_EXTERNAL}"\n` +
      `  data-bokito-chat-widget\n` +
      `  data-agent-slug="${slug}"\n` +
      `  data-api-url="${apiOrigin}"\n` +
      `  data-auth-mode="anonymous"\n` +
      `  defer\n` +
      `></script>\n` +
      `\n` +
      `<!-- Alternatief: laad de publieke widget rechtstreeks vanaf Xano (vereist werkende route script/external) -->\n` +
      `<!--\n` +
      `<script\n` +
      `  src="${xanoExternal}"\n` +
      `  data-agent-slug="${slug}"\n` +
      `  data-api-url="${apiOrigin}"\n` +
      `  data-auth-mode="anonymous"\n` +
      `  defer\n` +
      `></script>\n` +
      `-->`
    )
  }, [audience])

  const copyInstallationSnippet = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(installationHtmlSnippet)
      toast.success('HTML gekopieerd naar klembord')
      setInstallSnippetCopied(true)
      window.setTimeout(() => setInstallSnippetCopied(false), 2000)
    } catch {
      toast.error('Kopiëren mislukt')
    }
  }, [installationHtmlSnippet])

  useEffect(() => {
    const base = currentWorkspace?.messengerAppearance ?? DEFAULT_MESSENGER_APPEARANCE
    setDraft({ ...base })
    setSaved({ ...base })
    setWidgetFaviconFile(null)
    setFaviconPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
  }, [currentWorkspace?.id, JSON.stringify(currentWorkspace?.messengerAppearance ?? null)])

  const dirty = useMemo(() => {
    if (widgetFaviconFile) return true
    return !messengerAppearanceEquals(draft, saved)
  }, [draft, saved, widgetFaviconFile])

  const previewOverridesJson = useMemo(() => {
    const url = faviconPreviewUrl || draft.widget_favicon_url || ''
    return JSON.stringify(
      serializeAppearanceForWidgetPreview({
        ...draft,
        widget_favicon_url: url || null,
      }),
    )
  }, [draft, faviconPreviewUrl])

  useEffect(() => {
    if (!previewPanelActive) {
      const w = previewWidgetRef.current
      if (w) {
        w.remove()
        previewWidgetRef.current = null
      }
      return
    }
    const host = previewHostRef.current
    if (!host || !token) return
    if (previewWidgetRef.current && host.contains(previewWidgetRef.current)) return

    const el = document.createElement('bokito-chat')
    el.dataset.agentSlug = DASHBOARD_CHAT_AGENT_SLUG
    el.dataset.apiUrl = livechatWidgetHttpOrigin()
    el.dataset.authMode = 'optional'
    el.dataset.previewMode = 'true'
    el.dataset.previewOverrides = previewOverridesJson
    host.appendChild(el)
    previewWidgetRef.current = el

    return () => {
      previewWidgetRef.current = null
      el.remove()
    }
  }, [token, previewPanelActive])

  useEffect(() => {
    const w = previewWidgetRef.current
    if (w) w.dataset.previewOverrides = previewOverridesJson
  }, [previewOverridesJson])

  useEffect(() => {
    const w = previewWidgetRef.current
    if (!w) return
    w.setAttribute('data-theme', previewTheme)
  }, [previewTheme])

  const patchDraft = useCallback((partial: Partial<MessengerAppearance>) => {
    setDraft((prev) => ({ ...prev, ...partial }))
  }, [])

  const handleWidgetFaviconPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setSaveError('Kies een afbeeldingsbestand.')
      return
    }
    setSaveError(null)
    setWidgetFaviconFile(file)
    setFaviconPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
  }

  const clearWidgetFavicon = () => {
    setWidgetFaviconFile(null)
    setFaviconPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    patchDraft({ widget_favicon_url: null })
  }

  const handleSave = async () => {
    if (!token || !currentWorkspace?.id) {
      setSaveError('Geen actieve workspace of sessie.')
      return
    }
    setSaving(true)
    setSaveError(null)
    setSaveOk(false)
    try {
      const form = new FormData()
      form.append('name', (currentWorkspace.name || '').trim())
      form.append('subdomain', (currentWorkspace.slug || '').trim().toLowerCase())
      form.append('brand_color', (currentWorkspace.brand_color || '#4652f2').trim())
      form.append('appearance_json', JSON.stringify(appearanceToBrandingJson(draft)))
      if (widgetFaviconFile) {
        form.append('widget_favicon', widgetFaviconFile)
      }

      const res = await fetch(`${XANO_AUTH_API}${authRoutes.workspaceBranding(currentWorkspace.id)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
        body: form,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Onbekende fout' }))
        throw new Error(typeof err?.message === 'string' ? err.message : `HTTP ${res.status}`)
      }

      await refreshWorkspaces()
      setWidgetFaviconFile(null)
      setFaviconPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setSaved({ ...draft })
      setDraft({ ...draft })
      setSaveOk(true)
      window.setTimeout(() => setSaveOk(false), 2200)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Opslaan mislukt')
    } finally {
      setSaving(false)
    }
  }

  const mainOptions: { value: AssistentSection; label: string }[] = [
    { value: 'customization', label: 'Customization' },
    { value: 'agent', label: 'Agent settings' },
    { value: 'installation', label: 'Installation' },
  ]

  const agentModelOptions: { value: AgentModelSource; label: string }[] = [
    { value: 'bokito_ai', label: 'Bokito AI' },
    { value: 'custom', label: 'Custom' },
  ]

  const customizationOptions: { value: CustomizationPanel; label: string; icon: ReactNode }[] = [
    { value: 'content', label: 'Content', icon: <Type className="h-3.5 w-3.5 opacity-70" /> },
    { value: 'styling', label: 'Styling', icon: <Palette className="h-3.5 w-3.5 opacity-70" /> },
  ]

  const previewThemeOptions: { value: PreviewTheme; label: string; icon: ReactNode }[] = [
    { value: 'light', label: 'Light', icon: <Sun className="h-3.5 w-3.5 opacity-70" /> },
    { value: 'dark', label: 'Dark', icon: <Moon className="h-3.5 w-3.5 opacity-70" /> },
  ]

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex flex-col gap-3 border-b border-border/60 pb-4 lg:flex-row lg:flex-wrap lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:gap-3">
          <h2 className="shrink-0 text-[17px] font-semibold leading-none text-text-heading">Assistent</h2>
          <SegmentedControl
            value={audience}
            onChange={(v) => navigate(assistentSettingsPath(v, section))}
            options={embedNavOptions}
            className="max-w-md"
          />
          <SegmentedControl
            value={section}
            onChange={(v) => navigate(assistentSettingsPath(audience, v))}
            options={mainOptions}
            className="max-w-xl"
          />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          {saveError ? <p className="order-last w-full text-xs text-status-error sm:order-none sm:w-auto">{saveError}</p> : null}
          <Button size="sm" disabled={!dirty || saving} onClick={() => void handleSave()}>
            {saving ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Saving
              </>
            ) : saveOk ? (
              'Saved'
            ) : (
              'Save changes'
            )}
          </Button>
        </div>
      </div>

      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col pt-1',
          previewPanelActive && 'md:flex-row md:gap-0',
        )}
      >
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col overflow-y-auto rounded-b-lg bg-bg-surface/40 pb-6 md:border-border/55 dark:bg-transparent',
            previewPanelActive ? 'md:w-1/2 md:max-w-[50%] md:border-r md:pr-5' : 'w-full md:max-w-none',
          )}
        >
          <div className="flex flex-col gap-4 p-4 sm:p-6">
            {section === 'installation' ? (
              <p className="text-2xs leading-relaxed text-text-muted">
                <span className="font-medium text-text-secondary">Team</span> gebruikt het pad{' '}
                <span className="font-mono text-text-muted">/chat-widget/internal/</span>;{' '}
                <span className="font-medium text-text-secondary">publiek</span> gebruikt{' '}
                <span className="font-mono text-text-muted">/chat-widget/external/</span>. Parallel kunnen scripts via
                Xano als <span className="font-mono text-text-muted">/api:livechat/script/internal</span> en{' '}
                <span className="font-mono text-text-muted">/api:livechat/script/external</span> (zie snippet).
              </p>
            ) : null}

            {section === 'customization' ? (
              <>
                <div>
                  <label className="mb-3 block text-sm font-medium text-text-heading">Choose what you want to customize</label>
                  <SegmentedControl
                    value={customizationPanel}
                    onChange={setCustomizationPanel}
                    options={customizationOptions}
                  />
                </div>

                {customizationPanel === 'content' ? (
                  <div className="space-y-1">
                    <FoldableSection title="Modules configuration" defaultOpen>
                      <p className="mb-3 text-xs text-text-secondary">
                        Configure which modules should be available in your messenger. (Ordering and persistence will
                        follow when the backend supports it.)
                      </p>
                      <div className="space-y-2">
                        {[
                          { label: 'Home', enabled: true },
                          { label: 'Messages', enabled: true },
                          { label: 'Help', enabled: true },
                          { label: 'Changelog', enabled: false },
                        ].map((item) => (
                          <div
                            key={item.label}
                            className="flex items-center justify-between rounded-lg border border-border/55 bg-bg-surface/80 px-3 py-2.5 shadow-sm backdrop-blur-sm dark:bg-bg-surface/40"
                          >
                            <span className="text-sm text-text-primary">{item.label}</span>
                            <Switch checked={item.enabled} disabled aria-label={item.label} />
                          </div>
                        ))}
                      </div>
                    </FoldableSection>

                    <FoldableSection title="Welcome messages" defaultOpen>
                      <div className="space-y-4 pt-1">
                        <div>
                          <p className="text-sm font-medium text-text-heading">Assistant display name</p>
                          <Input
                            className="mt-2"
                            value={draft.chatbot_name}
                            onChange={(e) => patchDraft({ chatbot_name: e.target.value })}
                            placeholder="Bokito AI"
                          />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-text-heading">Welcome title</p>
                          <Input
                            className="mt-2"
                            value={draft.welcome_title}
                            onChange={(e) => patchDraft({ welcome_title: e.target.value })}
                            placeholder="Hallo!"
                          />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-text-heading">Welcome subtitle</p>
                          <Input
                            className="mt-2"
                            value={draft.welcome_subtitle}
                            onChange={(e) => patchDraft({ welcome_subtitle: e.target.value })}
                            placeholder="Stel je vraag aan ..."
                          />
                        </div>
                      </div>
                    </FoldableSection>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <FoldableSection title="Colors" defaultOpen>
                      <p className="mb-3 text-xs text-text-secondary">Used in the chat widget for buttons and highlights.</p>
                      <div>
                        <p className="text-sm font-medium text-text-heading">Accent</p>
                        <div className="mt-2">
                          <ColorField value={draft.main_color} onChange={(v) => patchDraft({ main_color: v })} />
                        </div>
                      </div>
                    </FoldableSection>

                    <FoldableSection title="Widget icon" defaultOpen>
                      <p className="mb-3 text-xs text-text-secondary">
                        Shown in the widget header. Separate from the browser tab favicon in company branding.
                      </p>
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-bg-surface/60">
                          {faviconPreviewUrl || draft.widget_favicon_url ? (
                            <img
                              src={faviconPreviewUrl || draft.widget_favicon_url || ''}
                              alt=""
                              className="h-6 w-6 object-contain"
                            />
                          ) : (
                            <Image size={16} className="text-text-muted" />
                          )}
                        </div>
                        {faviconPreviewUrl || draft.widget_favicon_url ? (
                          <button
                            type="button"
                            onClick={clearWidgetFavicon}
                            className="rounded-md border border-border px-3 py-1.5 text-[12px] text-text-secondary hover:bg-bg-hover"
                          >
                            Remove
                          </button>
                        ) : (
                          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-text-secondary hover:bg-bg-hover">
                            <Upload size={12} />
                            Upload
                            <input type="file" accept="image/*" className="hidden" onChange={handleWidgetFaviconPick} />
                          </label>
                        )}
                      </div>
                    </FoldableSection>
                  </div>
                )}
              </>
            ) : null}

            {section === 'agent' ? (
              <div className="space-y-4">
                <p className="text-xs text-text-secondary">
                  Options below are UI-only for now. Saving the page does not persist them yet. The live widget preview is
                  hidden on this tab.
                </p>

                <div>
                  <p className="mb-2 text-sm font-medium text-text-heading">Model</p>
                  <SegmentedControl
                    value={agentModelSource}
                    onChange={setAgentModelSource}
                    options={agentModelOptions}
                    className="max-w-md"
                  />
                  {agentModelSource === 'custom' ? (
                    <div className="mt-4 space-y-4 rounded-xl border border-border/55 bg-bg-surface/50 p-4 dark:bg-bg-surface/25">
                      <div>
                        <p className="text-sm font-medium text-text-heading">Model id</p>
                        <Input
                          className="mt-2"
                          value={customModelId}
                          onChange={(e) => setCustomModelId(e.target.value)}
                          placeholder="provider/model-name"
                          autoComplete="off"
                        />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-text-heading">Temperature</p>
                        <Input
                          className="mt-2 max-w-[120px]"
                          type="number"
                          min={0}
                          max={2}
                          step={0.05}
                          value={customTemperature}
                          onChange={(e) => setCustomTemperature(e.target.value)}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

                <FoldableSection title="Replies" defaultOpen>
                  <div className="space-y-4 pt-1">
                    <div>
                      <p className="text-sm font-medium text-text-heading">Default length</p>
                      <Select value={replyLength} onValueChange={(v) => setReplyLength(v as AgentReplyLength)}>
                        <SelectTrigger className="mt-2 max-w-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="concise">Concise</SelectItem>
                          <SelectItem value="balanced">Balanced</SelectItem>
                          <SelectItem value="detailed">Detailed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/55 bg-bg-surface/60 px-3 py-2.5 dark:bg-bg-surface/30">
                      <span className="text-sm text-text-primary">Stream responses</span>
                      <Switch checked={streamResponses} onCheckedChange={setStreamResponses} aria-label="Stream responses" />
                    </div>
                  </div>
                </FoldableSection>

                <FoldableSection title="Context and tools" defaultOpen>
                  <div className="space-y-4 pt-1">
                    <div>
                      <p className="text-sm font-medium text-text-heading">Conversation memory (turns)</p>
                      <Input
                        className="mt-2 max-w-[120px]"
                        type="number"
                        min={1}
                        max={64}
                        value={maxContextTurns}
                        onChange={(e) => setMaxContextTurns(e.target.value)}
                      />
                      <p className="mt-1.5 text-2xs text-text-muted">How many prior turns the agent may consider.</p>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/55 bg-bg-surface/60 px-3 py-2.5 dark:bg-bg-surface/30">
                      <span className="text-sm text-text-primary">Allow tool use</span>
                      <Switch checked={allowToolUse} onCheckedChange={setAllowToolUse} aria-label="Allow tool use" />
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/55 bg-bg-surface/60 px-3 py-2.5 dark:bg-bg-surface/30">
                      <span className="text-sm text-text-primary">Include visitor page context</span>
                      <Switch
                        checked={includeVisitorPageContext}
                        onCheckedChange={setIncludeVisitorPageContext}
                        aria-label="Include visitor page context"
                      />
                    </div>
                  </div>
                </FoldableSection>

                <FoldableSection title="Handoff" defaultOpen={false}>
                  <div className="space-y-3 pt-1">
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/55 bg-bg-surface/60 px-3 py-2.5 dark:bg-bg-surface/30">
                      <span className="text-sm text-text-primary">Offer human handoff when unsure</span>
                      <Switch checked={handoffToHuman} onCheckedChange={setHandoffToHuman} aria-label="Human handoff" />
                    </div>
                    <p className="text-2xs text-text-muted">
                      When enabled, the agent can suggest routing to a teammate. Routing rules will be configured in
                      Inbox later.
                    </p>
                  </div>
                </FoldableSection>
              </div>
            ) : null}

            {section === 'installation' ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-border/60 bg-bg-input/35 dark:bg-bg-input/25">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/55 px-4 py-3">
                    <p className="text-sm font-medium text-text-heading">
                      {audience === 'internal'
                        ? 'Team-widget (/chat-widget/internal/)'
                        : 'Publieke widget (/chat-widget/external/)'}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="shrink-0 gap-1.5"
                      onClick={() => void copyInstallationSnippet()}
                      aria-label="Kopieer embed-HTML"
                    >
                      {installSnippetCopied ? (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          Gekopieerd
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          Kopiëren
                        </>
                      )}
                    </Button>
                  </div>
                  <p className="px-4 pt-3 text-xs text-text-secondary">
                    Gebruik het <strong>eerste</strong> actieve scriptblok. Het tweede blok staat in HTML-commentaar: dat
                    is het Xano-pad (<span className="font-mono text-text-muted">script/internal</span> of{' '}
                    <span className="font-mono text-text-muted">script/external</span>) zodra die routes live staan.
                    Team: zet <span className="font-mono text-text-muted">data-auth-mode</span> op{' '}
                    <span className="font-mono text-text-muted">optional</span> of{' '}
                    <span className="font-mono text-text-muted">required</span> als je sessies wilt koppelen. Publiek:
                    houd <span className="font-mono text-text-muted">anonymous</span>.
                  </p>
                  <div className="p-4 pt-2">
                    <pre className="max-h-[min(60vh,420px)] overflow-auto rounded-lg border border-border/60 bg-[#141824] p-4 text-left shadow-inner">
                      <code className="block whitespace-pre font-mono text-[12px] leading-relaxed text-[#e2e8f0]">
                        {installationHtmlSnippet}
                      </code>
                    </pre>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {previewPanelActive ? (
          <div className="messenger-preview-canvas min-h-[380px] border-t border-border/40 md:min-h-0 md:w-1/2 md:max-w-[50%] md:border-l md:border-t-0">
            <div className="messenger-preview-stage flex min-h-0 flex-1 flex-col">
              <p className="sr-only">Live messenger preview</p>
              <div className="relative z-[2] flex min-h-0 flex-1 flex-col">
                <div className="messenger-preview-theme-row flex shrink-0 justify-center px-4 pb-2 pt-2">
                  <SegmentedControl
                    value={previewTheme}
                    onChange={setPreviewTheme}
                    options={previewThemeOptions}
                    className="max-w-[min(100%,280px)]"
                    stretch
                  />
                </div>
                <div
                  ref={previewHostRef}
                  className="messenger-preview-stage-host flex min-h-0 w-full flex-1 flex-col items-center justify-center px-4 pb-6 pt-1"
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default function MessengerSettings() {
  const params = useParams<{ audience: string; section: string }>()
  const parsed = useMemo(
    () => parseAssistentSettingsParams(params.audience, params.section),
    [params.audience, params.section],
  )
  if (!parsed) {
    return <Navigate to={ASSISTENT_DEFAULT_PATH} replace />
  }
  return <MessengerSettingsContent audience={parsed.audience} section={parsed.section} />
}
