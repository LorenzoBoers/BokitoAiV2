import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Link, useNavigate, useParams } from 'react-router-dom'
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
import { PageGuideBanner } from '../components/layout/PageGuideBanner'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Switch } from '../components/ui/switch'
import { useWorkspace } from '../context/WorkspaceContext'
import { useAuth } from '../context/AuthContext'
import { authRoutes } from '../api/routes/auth.routes'
import { policyRoutes } from '../api/routes/policy.routes'
import { AUTH_API_BASE } from '../lib/api'
import {
  CHAT_WIDGET_SCRIPT_PATH,
  DASHBOARD_CHAT_AGENT_SLUG,
  livechatWidgetHttpOrigin,
} from '../lib/api.config'
import { ensureChatWidgetScript } from '../lib/chat-widget-loader'
import {
  DEFAULT_MESSENGER_APPEARANCE,
  MESSENGER_MODULE_KEYS,
  appearanceToBrandingJson,
  messengerAppearanceEquals,
  resolveWidgetName,
  serializeAppearanceForWidgetPreview,
  welcomeDefaultsForLocale,
  type MessengerAppearance,
} from '../lib/messenger-appearance'
import {
  ASSISTANT_DEFAULT_PATH,
  assistantSettingsPath,
  parseAssistantSettingsParams,
  type AssistantAudience,
  type AssistantSection,
} from '../lib/assistant-settings-path'
import {
  getAiCommunicationSettings,
  getWidgetSettings,
  saveWidgetSettings,
  type WidgetSettings,
} from '../lib/inbox-api'
import { listAgents } from '../lib/agents-api'
import AgentBindingPicker from '../components/settings/AgentBindingPicker'
import { DEFAULT_BRAND_COLOR } from '../lib/tenant-branding'
import { cn } from '../lib/utils'
import { inboxPath } from '../lib/messages-paths'
import { toast } from 'sonner'
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard'

type CustomizationPanel = 'content' | 'styling'
type PreviewTheme = 'light' | 'dark'
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
        className="w-28 rounded-lg border border-border/60 bg-bg-surface/50 px-3 py-2 font-mono text-[13px] text-text-primary focus:border-accent/55 focus:outline-none"
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
        'max-w-full gap-0.5 rounded-xl border border-border/60 bg-bg-input/40 p-1 dark:bg-bg-input/55',
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
      {open ? <div className="border-t border-border/60 px-4 pb-4 pt-1">{children}</div> : null}
    </div>
  )
}

function MessengerSettingsContent({
  audience,
  section,
}: {
  audience: AssistantAudience
  section: AssistantSection
}) {
  const { t, i18n } = useTranslation('nav')
  const navigate = useNavigate()
  const { currentWorkspace, refreshWorkspaces } = useWorkspace()
  const { token } = useAuth()
  const previewHostRef = useRef<HTMLDivElement>(null)
  const previewWidgetRef = useRef<HTMLElement | null>(null)

  const [customizationPanel, setCustomizationPanel] = useState<CustomizationPanel>('content')
  const [previewTheme, setPreviewTheme] = useState<PreviewTheme>('dark')
  const previewThemeRef = useRef(previewTheme)
  previewThemeRef.current = previewTheme

  const [draft, setDraft] = useState<MessengerAppearance>(DEFAULT_MESSENGER_APPEARANCE)
  const [saved, setSaved] = useState<MessengerAppearance>(DEFAULT_MESSENGER_APPEARANCE)
  const [widgetFaviconFile, setWidgetFaviconFile] = useState<File | null>(null)
  const [faviconPreviewUrl, setFaviconPreviewUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState(false)

  const [personaTone, setPersonaTone] = useState('')
  const [personaDo, setPersonaDo] = useState('')
  const [personaDont, setPersonaDont] = useState('')
  const [installSnippetCopied, setInstallSnippetCopied] = useState(false)

  const [widgetBehaviour, setWidgetBehaviour] = useState<WidgetSettings | null>(null)
  const [widgetBehaviourSaving, setWidgetBehaviourSaving] = useState(false)

  // Placeholders mirror what the widget really shows when a field is empty:
  // assistant/tenant name and localized welcome defaults in the team language.
  const [assistantName, setAssistantName] = useState('')
  const [workspaceLanguage, setWorkspaceLanguage] = useState('en')
  const resolvedWidgetName = resolveWidgetName({
    assistantName,
    tenantName: currentWorkspace?.name ?? '',
  })
  const welcomeDefaults = welcomeDefaultsForLocale(workspaceLanguage)

  const previewPanelActive = section === 'customization' || section === 'installation'

  const embedNavOptions: { value: AssistantAudience; label: string; icon: ReactNode }[] = [
    { value: 'internal', label: t('messengerPage.internal'), icon: <Users className="h-3.5 w-3.5 opacity-70" /> },
    { value: 'external', label: t('messengerPage.external'), icon: <Globe className="h-3.5 w-3.5 opacity-70" /> },
  ]

  const installationHtmlSnippet = useMemo(() => {
    const apiOrigin = livechatWidgetHttpOrigin()
    const slug = DASHBOARD_CHAT_AGENT_SLUG
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const tenantSlug = (currentWorkspace?.slug || '').trim().toLowerCase()
    const tenantAttr = tenantSlug ? `  data-tenant="${tenantSlug}"\n` : ''

    if (audience === 'internal') {
      return (
        `<!-- Bokito assistant for logged-in users of your platform. -->\n` +
        `<!-- Pass the user's Bokito access token so the assistant knows who they are: -->\n` +
        `<!--   window.BokitoConfig = { getAuthToken: () => yourAccessToken }        -->\n` +
        `<script\n` +
        `  src="${origin}${CHAT_WIDGET_SCRIPT_PATH}"\n` +
        `  data-bokito-chat-widget\n` +
        `  data-agent-slug="${slug}"\n` +
        `  data-api-url="${apiOrigin}"\n` +
        tenantAttr +
        `  data-auth-mode="required"\n` +
        `  defer\n` +
        `></script>`
      )
    }
    return (
      `<!-- Bokito chat widget for anonymous website visitors. -->\n` +
      `<script\n` +
      `  src="${origin}${CHAT_WIDGET_SCRIPT_PATH}"\n` +
      `  data-bokito-chat-widget\n` +
      `  data-agent-slug="${slug}"\n` +
      `  data-api-url="${apiOrigin}"\n` +
      tenantAttr +
      `  data-auth-mode="anonymous"\n` +
      `  defer\n` +
      `></script>`
    )
  }, [audience, currentWorkspace?.slug])

  const copyInstallationSnippet = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(installationHtmlSnippet)
      toast.success(t('messengerPage.copiedHtml'))
      setInstallSnippetCopied(true)
      window.setTimeout(() => setInstallSnippetCopied(false), 2000)
    } catch {
      toast.error(t('messengerPage.copyFailed'))
    }
  }, [installationHtmlSnippet, t])

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

  useEffect(() => {
    if (!token) return
    fetch(`/api${policyRoutes.persona()}`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('persona load failed'))))
      .then((data: { tone?: string; do_text?: string; dont_text?: string }) => {
        setPersonaTone(data.tone ?? '')
        setPersonaDo(data.do_text ?? '')
        setPersonaDont(data.dont_text ?? '')
      })
      .catch(() => {
        // keep defaults
      })
  }, [token])

  useEffect(() => {
    if (!token) return
    getWidgetSettings(token)
      .then(setWidgetBehaviour)
      .catch(() => {
        // keep defaults; the section shows a loading placeholder
      })
  }, [token])

  useEffect(() => {
    if (!token) return
    listAgents()
      .then((agents) => {
        const assistant = agents.find((a) => a.role_slug === 'assistant')
        setAssistantName(assistant?.name ?? '')
      })
      .catch(() => {
        // tenant name remains the placeholder fallback
      })
    getAiCommunicationSettings(token)
      .then((settings) => setWorkspaceLanguage(settings.workspaceLanguage))
      .catch(() => {
        // English welcome defaults remain
      })
  }, [token])

  const handleSaveWidgetBehaviour = useCallback(async () => {
    if (!token || !widgetBehaviour) return
    setWidgetBehaviourSaving(true)
    try {
      const next = await saveWidgetSettings(token, {
        preChatForm: widgetBehaviour.preChatForm,
        offlineMessage: widgetBehaviour.offlineMessage,
        officeHours: widgetBehaviour.officeHours,
      })
      setWidgetBehaviour(next)
      toast.success(t('messengerPage.availabilitySaved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('messengerPage.availabilityError'))
    } finally {
      setWidgetBehaviourSaving(false)
    }
  }, [token, widgetBehaviour, t])

  const dirty = useMemo(() => {
    if (widgetFaviconFile) return true
    return !messengerAppearanceEquals(draft, saved)
  }, [draft, saved, widgetFaviconFile])
  useUnsavedChangesGuard(dirty && !saving, t('messengerPage.unsavedLeave'))

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

    let cancelled = false
    let el: HTMLElement | null = null
    void ensureChatWidgetScript()
      .then(() => {
        if (cancelled || !previewHostRef.current) return
        el = document.createElement('bokito-chat')
        el.dataset.agentSlug = DASHBOARD_CHAT_AGENT_SLUG
        el.dataset.apiUrl = livechatWidgetHttpOrigin()
        el.dataset.authMode = 'optional'
        if (currentWorkspace?.slug) el.dataset.tenant = currentWorkspace.slug
        el.dataset.previewMode = 'true'
        el.dataset.previewOverrides = previewOverridesJson
        el.dataset.locale = (i18n.language || 'en').slice(0, 2)
        el.setAttribute('data-theme', previewThemeRef.current)
        previewHostRef.current.appendChild(el)
        previewWidgetRef.current = el
      })
      .catch(() => {
        // Bundle missing (widget not built); the preview stage stays empty.
      })

    return () => {
      cancelled = true
      previewWidgetRef.current = null
      el?.remove()
    }
  }, [token, previewPanelActive, currentWorkspace?.slug, i18n.language])

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
      setSaveError(t('messengerPage.chooseImage'))
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
      setSaveError(t('messengerPage.noWorkspace'))
      return
    }
    setSaving(true)
    setSaveError(null)
    setSaveOk(false)
    try {
      const form = new FormData()
      form.append('name', (currentWorkspace.name || '').trim())
      form.append('subdomain', (currentWorkspace.slug || '').trim().toLowerCase())
      form.append('brand_color', (currentWorkspace.brand_color || DEFAULT_BRAND_COLOR).trim())
      form.append('appearance_json', JSON.stringify(appearanceToBrandingJson(draft)))
      if (widgetFaviconFile) {
        form.append('widget_favicon', widgetFaviconFile)
      }

      const res = await fetch(`${AUTH_API_BASE}${authRoutes.workspaceBranding(currentWorkspace.id)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
        body: form,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Unknown error' }))
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
      const personaRes = await fetch(`/api${policyRoutes.persona()}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          tone: personaTone,
          do_text: personaDo,
          dont_text: personaDont,
        }),
      })
      if (!personaRes.ok) {
        throw new Error(t('messengerPage.personaError'))
      }

      setSaveOk(true)
      window.setTimeout(() => setSaveOk(false), 2200)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t('messengerPage.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const mainOptions: { value: AssistantSection; label: string }[] = [
    { value: 'customization', label: t('messengerPage.customization') },
    { value: 'agent', label: t('messengerPage.agent') },
    { value: 'installation', label: t('messengerPage.installation') },
  ]

  const customizationOptions: { value: CustomizationPanel; label: string; icon: ReactNode }[] = [
    { value: 'content', label: t('messengerPage.content'), icon: <Type className="h-3.5 w-3.5 opacity-70" /> },
    { value: 'styling', label: t('messengerPage.styling'), icon: <Palette className="h-3.5 w-3.5 opacity-70" /> },
  ]

  const previewThemeOptions: { value: PreviewTheme; label: string; icon: ReactNode }[] = [
    { value: 'light', label: t('messengerPage.light'), icon: <Sun className="h-3.5 w-3.5 opacity-70" /> },
    { value: 'dark', label: t('messengerPage.dark'), icon: <Moon className="h-3.5 w-3.5 opacity-70" /> },
  ]

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <PageGuideBanner page="widget" className="mb-4" />
      <div className="flex flex-col gap-3 border-b border-border/60 pb-4 lg:flex-row lg:flex-wrap lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:gap-3">
          <h2 className="shrink-0 text-[17px] font-semibold leading-none text-text-heading">{t('messengerPage.title')}</h2>
          <SegmentedControl
            value={audience}
            onChange={(v) => navigate(assistantSettingsPath(v, section))}
            options={embedNavOptions}
            className="max-w-md"
          />
          <SegmentedControl
            value={section}
            onChange={(v) => navigate(assistantSettingsPath(audience, v))}
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
                {t('messengerPage.saving')}
              </>
            ) : saveOk ? (
              t('messengerPage.saved')
            ) : (
              t('messengerPage.saveChanges')
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
            'flex min-h-0 flex-1 flex-col overflow-y-auto rounded-b-lg bg-bg-surface/40 pb-6 md:border-border/60 dark:bg-transparent',
            previewPanelActive ? 'md:w-1/2 md:max-w-[50%] md:border-r md:pr-5' : 'w-full md:max-w-none',
          )}
        >
          <div className="flex flex-col gap-4 p-4 sm:p-6">
            {section === 'installation' ? (
              <p className="text-2xs leading-relaxed text-text-muted">
                {audience === 'internal'
                  ? t('messengerPage.installInternalBody')
                  : t('messengerPage.installExternalBody')}
              </p>
            ) : null}

            {section === 'customization' ? (
              <>
                <div>
                  <label className="mb-3 block text-sm font-medium text-text-heading">{t('messengerPage.customizeWhat')}</label>
                  <SegmentedControl
                    value={customizationPanel}
                    onChange={setCustomizationPanel}
                    options={customizationOptions}
                  />
                </div>

                {customizationPanel === 'content' ? (
                  <div className="space-y-1">
                    <FoldableSection title={t('messengerPage.modulesTitle')} defaultOpen>
                      <p className="mb-3 text-xs text-text-secondary">
                        {t('messengerPage.modulesBody')}
                      </p>
                      <div className="space-y-2">
                        {MESSENGER_MODULE_KEYS.map((key) => (
                          <div
                            key={key}
                            className="flex items-center justify-between rounded-lg border border-border/60 bg-bg-surface/80 px-3 py-2.5 shadow-sm backdrop-blur-sm dark:bg-bg-surface/40"
                          >
                            <span className="text-sm text-text-primary">{t(`messengerPage.modules.${key}`)}</span>
                            <Switch
                              checked={draft.modules[key]}
                              onCheckedChange={(checked) =>
                                patchDraft({ modules: { ...draft.modules, [key]: checked } })
                              }
                              aria-label={t(`messengerPage.modules.${key}`)}
                            />
                          </div>
                        ))}
                      </div>
                    </FoldableSection>

                    <FoldableSection title={t('messengerPage.welcomeTitle')} defaultOpen>
                      <div className="space-y-4 pt-1">
                        <div>
                          <p className="text-sm font-medium text-text-heading">{t('messengerPage.displayName')}</p>
                          <Input
                            className="mt-2"
                            value={draft.chatbot_name}
                            onChange={(e) => patchDraft({ chatbot_name: e.target.value })}
                            placeholder={resolvedWidgetName || t('messengerPage.displayNamePlaceholder')}
                          />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-text-heading">{t('messengerPage.handlingAgent')}</p>
                          <p className="mt-0.5 text-xs text-text-muted">{t('messengerPage.handlingAgentHint')}</p>
                          <AgentBindingPicker
                            channel="widget"
                            className="mt-2 h-9 w-full max-w-sm rounded-md border border-border/60 bg-bg-elevated px-2 text-sm text-text-secondary focus:outline-none focus:ring-1 focus:ring-border-focus disabled:opacity-40"
                          />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-text-heading">{t('messengerPage.welcomeHeading')}</p>
                          <Input
                            className="mt-2"
                            value={draft.welcome_title}
                            onChange={(e) => patchDraft({ welcome_title: e.target.value })}
                            placeholder={welcomeDefaults.title}
                          />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-text-heading">{t('messengerPage.welcomeSubtitle')}</p>
                          <Input
                            className="mt-2"
                            value={draft.welcome_subtitle}
                            onChange={(e) => patchDraft({ welcome_subtitle: e.target.value })}
                            placeholder={welcomeDefaults.subtitle}
                          />
                        </div>
                      </div>
                    </FoldableSection>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <FoldableSection title={t('messengerPage.colorsTitle')} defaultOpen>
                      <p className="mb-3 text-xs text-text-secondary">{t('messengerPage.colorsBody')}</p>
                      <div>
                        <p className="text-sm font-medium text-text-heading">{t('messengerPage.accent')}</p>
                        <div className="mt-2">
                          <ColorField value={draft.main_color} onChange={(v) => patchDraft({ main_color: v })} />
                        </div>
                      </div>
                    </FoldableSection>

                    <FoldableSection title={t('messengerPage.iconTitle')} defaultOpen>
                      <p className="mb-3 text-xs text-text-secondary">
                        {t('messengerPage.iconBody')}
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
                            {t('messengerPage.remove')}
                          </button>
                        ) : (
                          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-text-secondary hover:bg-bg-hover">
                            <Upload size={12} />
                            {t('messengerPage.upload')}
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
                <FoldableSection title={t('messengerPage.personaTitle')} defaultOpen>
                    <div className="space-y-3 pt-1">
                      <div>
                        <p className="text-sm font-medium text-text-heading">{t('messengerPage.tone')}</p>
                        <Input
                          className="mt-2"
                          value={personaTone}
                          onChange={(e) => setPersonaTone(e.target.value)}
                          placeholder={t('messengerPage.tonePlaceholder')}
                        />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-text-heading">{t('messengerPage.do')}</p>
                        <textarea
                          className="mt-2 w-full min-h-[80px] rounded-lg border border-border/60 bg-bg-input/80 px-3 py-2 text-sm"
                          value={personaDo}
                          onChange={(e) => setPersonaDo(e.target.value)}
                        />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-text-heading">{t('messengerPage.dont')}</p>
                        <textarea
                          className="mt-2 w-full min-h-[80px] rounded-lg border border-border/60 bg-bg-input/80 px-3 py-2 text-sm"
                          value={personaDont}
                          onChange={(e) => setPersonaDont(e.target.value)}
                        />
                      </div>
                      <p className="text-xs text-text-secondary">
                        {t('messengerPage.personaHint')}
                      </p>
                    </div>
                </FoldableSection>

                <FoldableSection title={t('messengerPage.availability')} defaultOpen>
                  {!widgetBehaviour ? (
                    <p className="pt-1 text-sm text-text-muted">{t('messengerPage.loading')}</p>
                  ) : (
                    <div className="space-y-4 pt-1">
                      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-bg-surface/60 px-3 py-2.5 dark:bg-bg-surface/30">
                        <div>
                          <span className="text-sm text-text-primary">{t('messengerPage.preChat')}</span>
                          <p className="text-2xs text-text-muted">
                            {t('messengerPage.preChatHint')}
                          </p>
                        </div>
                        <Switch
                          checked={widgetBehaviour.preChatForm}
                          onCheckedChange={(checked) =>
                            setWidgetBehaviour({ ...widgetBehaviour, preChatForm: checked })
                          }
                          aria-label={t('messengerPage.preChat')}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-bg-surface/60 px-3 py-2.5 dark:bg-bg-surface/30">
                        <div>
                          <span className="text-sm text-text-primary">{t('messengerPage.officeHours')}</span>
                          <p className="text-2xs text-text-muted">
                            {t('messengerPage.officeHoursHint')}
                            {widgetBehaviour.officeHours.enabled
                              ? widgetBehaviour.officeOpen
                                ? ` ${t('messengerPage.currentlyOpen')}`
                                : ` ${t('messengerPage.currentlyClosed')}`
                              : ''}
                          </p>
                        </div>
                        <Switch
                          checked={widgetBehaviour.officeHours.enabled}
                          onCheckedChange={(checked) =>
                            setWidgetBehaviour({
                              ...widgetBehaviour,
                              officeHours: { ...widgetBehaviour.officeHours, enabled: checked },
                            })
                          }
                          aria-label={t('messengerPage.officeHours')}
                        />
                      </div>
                      {widgetBehaviour.officeHours.enabled ? (
                        <div className="space-y-3 rounded-lg border border-border/60 bg-bg-surface/50 p-3 dark:bg-bg-surface/25">
                          <div className="flex flex-wrap gap-1.5">
                            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, day) => {
                              const active = widgetBehaviour.officeHours.days.includes(day)
                              return (
                                <button
                                  key={label}
                                  type="button"
                                  onClick={() =>
                                    setWidgetBehaviour({
                                      ...widgetBehaviour,
                                      officeHours: {
                                        ...widgetBehaviour.officeHours,
                                        days: active
                                          ? widgetBehaviour.officeHours.days.filter((d) => d !== day)
                                          : [...widgetBehaviour.officeHours.days, day].sort(),
                                      },
                                    })
                                  }
                                  className={cn(
                                    'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                                    active
                                      ? 'border-accent/50 bg-accent/10 text-accent'
                                      : 'border-border/60 text-text-secondary hover:text-text-primary',
                                  )}
                                >
                                  {label}
                                </button>
                              )
                            })}
                          </div>
                          <div className="flex flex-wrap items-center gap-3">
                            <div>
                              <p className="text-2xs font-medium text-text-muted">{t('messengerPage.from')}</p>
                              <Input
                                className="mt-1 w-[110px]"
                                type="time"
                                value={widgetBehaviour.officeHours.start}
                                onChange={(e) =>
                                  setWidgetBehaviour({
                                    ...widgetBehaviour,
                                    officeHours: { ...widgetBehaviour.officeHours, start: e.target.value },
                                  })
                                }
                              />
                            </div>
                            <div>
                              <p className="text-2xs font-medium text-text-muted">{t('messengerPage.until')}</p>
                              <Input
                                className="mt-1 w-[110px]"
                                type="time"
                                value={widgetBehaviour.officeHours.end}
                                onChange={(e) =>
                                  setWidgetBehaviour({
                                    ...widgetBehaviour,
                                    officeHours: { ...widgetBehaviour.officeHours, end: e.target.value },
                                  })
                                }
                              />
                            </div>
                            <div>
                              <p className="text-2xs font-medium text-text-muted">{t('messengerPage.timezone')}</p>
                              <Input
                                className="mt-1 w-[200px]"
                                value={widgetBehaviour.officeHours.timezone}
                                onChange={(e) =>
                                  setWidgetBehaviour({
                                    ...widgetBehaviour,
                                    officeHours: { ...widgetBehaviour.officeHours, timezone: e.target.value },
                                  })
                                }
                                placeholder={t('messengerPage.timezonePlaceholder')}
                              />
                            </div>
                          </div>
                        </div>
                      ) : null}
                      <div>
                        <p className="text-sm font-medium text-text-heading">{t('messengerPage.offlineMessage')}</p>
                        <textarea
                          className="mt-2 w-full min-h-[64px] rounded-lg border border-border/60 bg-bg-input/80 px-3 py-2 text-sm"
                          value={widgetBehaviour.offlineMessage}
                          onChange={(e) =>
                            setWidgetBehaviour({ ...widgetBehaviour, offlineMessage: e.target.value })
                          }
                          placeholder={t('messengerPage.offlinePlaceholder')}
                        />
                      </div>
                      <Button
                        size="sm"
                        disabled={widgetBehaviourSaving}
                        onClick={() => void handleSaveWidgetBehaviour()}
                      >
                        {widgetBehaviourSaving ? (
                          <>
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            {t('messengerPage.saving')}
                          </>
                        ) : (
                          t('messengerPage.saveAvailability')
                        )}
                      </Button>
                    </div>
                  )}
                </FoldableSection>
              </div>
            ) : null}

            {section === 'installation' ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-border/60 bg-bg-input/35 dark:bg-bg-input/25">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
                    <p className="text-sm font-medium text-text-heading">
                      {audience === 'internal'
                        ? t('messengerPage.installInternalTitle')
                        : t('messengerPage.installExternalTitle')}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="shrink-0 gap-1.5"
                      onClick={() => void copyInstallationSnippet()}
                      aria-label={t('messengerPage.copyAria')}
                    >
                      {installSnippetCopied ? (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          {t('messengerPage.copied')}
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          {t('messengerPage.copySnippet')}
                        </>
                      )}
                    </Button>
                  </div>
                  <p className="px-4 pt-3 text-xs text-text-secondary">
                    {audience === 'internal'
                      ? t('messengerPage.installInternalBody')
                      : t('messengerPage.installExternalBody')}
                  </p>
                  <div className="p-4 pt-2">
                    <pre className="max-h-[min(60vh,420px)] overflow-auto rounded-lg border border-border/60 bg-[#141824] p-4 text-left shadow-inner">
                      <code className="block whitespace-pre font-mono text-[12px] leading-relaxed text-[#e2e8f0]">
                        {installationHtmlSnippet}
                      </code>
                    </pre>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border/60 px-4 py-3">
                    {installSnippetCopied ? (
                      <button
                        type="button"
                        onClick={() => navigate(assistantSettingsPath(audience, 'customization'))}
                        className="text-[12px] font-medium text-accent hover:underline"
                        title={t('messengerPage.checkInstallationHint')}
                      >
                        {t('messengerPage.checkInstallation')}
                      </button>
                    ) : null}
                    <Link
                      to={inboxPath('open')}
                      className="text-[12px] font-medium text-accent hover:underline"
                    >
                      {t('messengerPage.openCommunication')}
                    </Link>
                    <Link
                      to="/settings/help-centers"
                      className="text-[12px] font-medium text-accent hover:underline"
                    >
                      {t('messengerPage.openHelpCenters')}
                    </Link>
                    <Link
                      to="/settings/setup"
                      className="text-[12px] font-medium text-accent hover:underline"
                    >
                      {t('messengerPage.openSetup')}
                    </Link>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {previewPanelActive ? (
          <div className="messenger-preview-canvas min-h-[380px] border-t border-border/40 md:min-h-0 md:w-1/2 md:max-w-[50%] md:border-l md:border-t-0">
            <div className="messenger-preview-stage flex min-h-0 flex-1 flex-col">
              <p className="sr-only">{t('messengerPage.previewAria')}</p>
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
    () => parseAssistantSettingsParams(params.audience, params.section),
    [params.audience, params.section],
  )
  if (!parsed) {
    return <Navigate to={ASSISTANT_DEFAULT_PATH} replace />
  }
  return <MessengerSettingsContent audience={parsed.audience} section={parsed.section} />
}
