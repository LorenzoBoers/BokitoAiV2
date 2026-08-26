import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Gauge, Globe, Languages, Mail, MessageCircle, MessageSquareText, UserRound } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { EmptyState } from '../components/ui/empty-state'
import { LoadingBlock } from '../components/ui/loading-block'
import { Label } from '../components/ui/label'
import PageContent from '../components/layout/PageContent'
import { PageIntro } from '../components/layout/PageIntro'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import ProviderLogo from '../components/email/ProviderLogo'
import ChannelBindingsPanel from '../components/settings/ChannelBindingsPanel'
import { useAuth } from '../context/AuthContext'
import { useMailboxConnections } from '../hooks/useMailboxConnections'
import { getAiConfig, saveAiConfig, type MailboxAiMode, type MailboxReplyLanguage } from '../lib/email-api'
import {
  getAiCommunicationSettings,
  getInboxTriageSettings,
  saveAiCommunicationSettings,
  saveInboxTriageSettings,
  type AiCommunicationSettings as AiSettings,
  type AiMode,
  type ChannelAiModes,
  type ReplyLanguage,
  type ReplySendAs,
  type WorkspaceLanguage,
} from '../lib/inbox-api'
import { resetTenantDefaultSendAs } from '../lib/reply-send-as'
import { WEBSITE_WIDGET_CUSTOMIZE_PATH, WEBSITE_WIDGET_PATH } from '../lib/assistant-settings-path'
import { inboxPath } from '../lib/messages-paths'

const MODES: AiMode[] = ['suggest', 'auto', 'off']
const REPLY_LANGUAGES: ReplyLanguage[] = ['auto', 'nl', 'en', 'de', 'fr', 'es']
const WORKSPACE_LANGUAGES: WorkspaceLanguage[] = ['nl', 'en', 'de', 'fr', 'es']

type ModeSelectProps = {
  id: string
  value: string
  onChange: (value: string) => void
  includeDefault?: boolean
  defaultLabel?: string
}

function ModeSelect({ id, value, onChange, includeDefault, defaultLabel }: ModeSelectProps) {
  const { t } = useTranslation('nav')
  return (
    <Select value={value || 'default'} onValueChange={(v) => onChange(v === 'default' ? '' : v)}>
      <SelectTrigger id={id} className="w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {includeDefault ? <SelectItem value="default">{defaultLabel}</SelectItem> : null}
        {MODES.map((mode) => (
          <SelectItem key={mode} value={mode}>
            {t(`ai.communication.modeOptions.${mode}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function LanguageSelect({
  id,
  value,
  languages,
  onChange,
  includeDefault,
  defaultLabel,
}: {
  id: string
  value: string
  languages: readonly string[]
  onChange: (value: string) => void
  includeDefault?: boolean
  defaultLabel?: string
}) {
  const { t } = useTranslation('nav')
  return (
    <Select value={value || 'default'} onValueChange={(v) => onChange(v === 'default' ? '' : v)}>
      <SelectTrigger id={id} className="w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {includeDefault ? <SelectItem value="default">{defaultLabel}</SelectItem> : null}
        {languages.map((lang) => (
          <SelectItem key={lang} value={lang}>
            {t(`ai.communication.languageOptions.${lang}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default function AiCommunicationSettings() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const { activeConnections: activeMailboxes, loading: mailboxesLoading } = useMailboxConnections()

  // Tenant-wide channel defaults + language policy
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null)
  const [savedAiSettings, setSavedAiSettings] = useState<AiSettings | null>(null)
  const [modesError, setModesError] = useState<string | null>(null)

  // Triage certainty threshold (1-10)
  const [certainty, setCertainty] = useState<number | null>(null)
  const [savedCertainty, setSavedCertainty] = useState<number | null>(null)

  // Per-mailbox override
  const [connectionId, setConnectionId] = useState<number | null>(null)
  const [mailboxMode, setMailboxMode] = useState<MailboxAiMode | ''>('')
  const [savedMailboxMode, setSavedMailboxMode] = useState<MailboxAiMode | ''>('')
  const [mailboxLanguage, setMailboxLanguage] = useState<MailboxReplyLanguage>('')
  const [savedMailboxLanguage, setSavedMailboxLanguage] = useState<MailboxReplyLanguage>('')
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const modes: ChannelAiModes | null = aiSettings?.modes ?? null

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void getAiCommunicationSettings(token)
      .then((data) => {
        if (!cancelled) {
          setAiSettings(data)
          setSavedAiSettings(data)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setModesError(err instanceof Error ? err.message : t('ai.communication.loadError'))
        }
      })
    return () => {
      cancelled = true
    }
  }, [token, t])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void getInboxTriageSettings(token)
      .then((data) => {
        if (!cancelled) {
          setCertainty(data.certaintyThreshold)
          setSavedCertainty(data.certaintyThreshold)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => {
    if (activeMailboxes.length === 0) {
      setConnectionId(null)
      return
    }
    if (connectionId == null || !activeMailboxes.some((m) => m.id === connectionId)) {
      setConnectionId(activeMailboxes[0].id)
    }
  }, [activeMailboxes, connectionId])

  useEffect(() => {
    if (!token || connectionId == null) return
    let cancelled = false
    setLoadingConfig(true)
    setLoadError(null)
    void getAiConfig(token, connectionId)
      .then((data) => {
        if (!cancelled) {
          setMailboxMode(data.mode)
          setSavedMailboxMode(data.mode)
          setMailboxLanguage(data.replyLanguage)
          setSavedMailboxLanguage(data.replyLanguage)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : t('ai.communication.loadError'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingConfig(false)
      })
    return () => {
      cancelled = true
    }
  }, [token, connectionId, t])

  const tenantDirty =
    aiSettings != null &&
    savedAiSettings != null &&
    JSON.stringify(aiSettings) !== JSON.stringify(savedAiSettings)
  const mailboxDirty = mailboxMode !== savedMailboxMode || mailboxLanguage !== savedMailboxLanguage
  const certaintyDirty = certainty != null && certainty !== savedCertainty
  const isDirty = tenantDirty || mailboxDirty || certaintyDirty

  const handleSave = useCallback(async () => {
    if (!token) return
    setSaving(true)
    setSaveMessage(null)
    try {
      if (tenantDirty && aiSettings) {
        await saveAiCommunicationSettings(token, {
          modes: aiSettings.modes,
          replyLanguage: aiSettings.replyLanguage,
          workspaceLanguage: aiSettings.workspaceLanguage,
          replySendAs: aiSettings.replySendAs,
        })
        setSavedAiSettings(aiSettings)
        // Decision cards cache the tenant default per session; refresh it.
        resetTenantDefaultSendAs()
      }
      if (connectionId != null && mailboxDirty) {
        await saveAiConfig(token, connectionId, { mode: mailboxMode, replyLanguage: mailboxLanguage })
        setSavedMailboxMode(mailboxMode)
        setSavedMailboxLanguage(mailboxLanguage)
      }
      if (certaintyDirty && certainty != null) {
        await saveInboxTriageSettings(token, { certaintyThreshold: certainty })
        setSavedCertainty(certainty)
      }
      setSaveMessage(t('ai.communication.saved'))
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : t('ai.communication.saveError'))
    } finally {
      setSaving(false)
    }
  }, [token, aiSettings, tenantDirty, connectionId, mailboxDirty, mailboxMode, mailboxLanguage, certaintyDirty, certainty, t])

  return (
    <PageContent width="md" className="space-y-6">
      <PageIntro description={t('ai.pageMeta.communication.description')} />

      <div className="rounded-lg border border-border/60 bg-bg-elevated/40 px-4 py-3 text-sm text-text-secondary">
        <p>{t('ai.communication.crossLinks.body')}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <Link to="/settings/channels" className="font-medium text-accent hover:underline">
            {t('ai.communication.crossLinks.channels')}
          </Link>
          <Link to={WEBSITE_WIDGET_CUSTOMIZE_PATH} className="font-medium text-accent hover:underline">
            {t('ai.communication.crossLinks.widget')}
          </Link>
          <Link to={WEBSITE_WIDGET_PATH} className="font-medium text-accent hover:underline">
            {t('ai.communication.crossLinks.installWidget')}
          </Link>
          <Link to="/agents" className="font-medium text-accent hover:underline">
            {t('ai.communication.crossLinks.agents')}
          </Link>
          <Link to="/settings/govern?tab=policy" className="font-medium text-accent hover:underline">
            {t('ai.communication.crossLinks.govern')}
          </Link>
          <Link to={inboxPath('open')} className="font-medium text-accent hover:underline">
            {t('ai.communication.crossLinks.communication')}
          </Link>
        </div>
      </div>

      <Card className="p-5 space-y-5">
        <div>
          <h2 className="text-sm font-medium text-text-heading">
            {t('ai.communication.channelDefaultsTitle')}
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            {t('ai.communication.channelDefaultsDescription')}
          </p>
        </div>
        {modesError ? <p className="text-xs text-destructive">{modesError}</p> : null}
        {!modes ? (
          <LoadingBlock variant="inline" label={t('ai.communication.loadingConfig')} />
        ) : (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <Mail size={16} className="mt-0.5 text-accent" />
                <div>
                  <Label htmlFor="ai-mode-email" className="text-sm font-medium">
                    {t('ai.communication.channelEmail')}
                  </Label>
                  <p className="text-xs text-text-muted mt-0.5 max-w-sm">
                    {t(`ai.communication.modeHints.${modes.email}`)}
                  </p>
                </div>
              </div>
              <ModeSelect
                id="ai-mode-email"
                value={modes.email}
                onChange={(v) => {
                  setAiSettings((prev) =>
                    prev ? { ...prev, modes: { ...prev.modes, email: v as AiMode } } : prev,
                  )
                  setSaveMessage(null)
                }}
              />
            </div>
            <div className="flex items-start justify-between gap-4 border-t border-border/60 pt-5">
              <div className="flex items-start gap-3">
                <Globe size={16} className="mt-0.5 text-accent" />
                <div>
                  <Label htmlFor="ai-mode-widget" className="text-sm font-medium">
                    {t('ai.communication.channelWidget')}
                  </Label>
                  <p className="text-xs text-text-muted mt-0.5 max-w-sm">
                    {t(`ai.communication.modeHints.${modes.widget}`)}
                  </p>
                </div>
              </div>
              <ModeSelect
                id="ai-mode-widget"
                value={modes.widget}
                onChange={(v) => {
                  setAiSettings((prev) =>
                    prev ? { ...prev, modes: { ...prev.modes, widget: v as AiMode } } : prev,
                  )
                  setSaveMessage(null)
                }}
              />
            </div>
            <div className="flex items-start justify-between gap-4 border-t border-border/60 pt-5">
              <div className="flex items-start gap-3">
                <MessageCircle size={16} className="mt-0.5 text-accent" />
                <div>
                  <Label htmlFor="ai-mode-whatsapp" className="text-sm font-medium">
                    {t('ai.communication.channelWhatsapp')}
                  </Label>
                  <p className="text-xs text-text-muted mt-0.5 max-w-sm">
                    {t(`ai.communication.modeHints.${modes.whatsapp}`)}
                  </p>
                </div>
              </div>
              <ModeSelect
                id="ai-mode-whatsapp"
                value={modes.whatsapp}
                onChange={(v) => {
                  setAiSettings((prev) =>
                    prev ? { ...prev, modes: { ...prev.modes, whatsapp: v as AiMode } } : prev,
                  )
                  setSaveMessage(null)
                }}
              />
            </div>
          </div>
        )}
      </Card>

      <Card className="p-5 space-y-5">
        <div>
          <h2 className="text-sm font-medium text-text-heading">
            {t('ai.communication.languageTitle')}
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            {t('ai.communication.languageDescription')}
          </p>
        </div>
        {!aiSettings ? (
          <LoadingBlock variant="inline" label={t('ai.communication.loadingConfig')} />
        ) : (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <Languages size={16} className="mt-0.5 text-accent" />
                <div>
                  <Label htmlFor="ai-reply-language" className="text-sm font-medium">
                    {t('ai.communication.replyLanguageLabel')}
                  </Label>
                  <p className="text-xs text-text-muted mt-0.5 max-w-sm">
                    {t('ai.communication.replyLanguageHint')}
                  </p>
                </div>
              </div>
              <LanguageSelect
                id="ai-reply-language"
                value={aiSettings.replyLanguage}
                languages={REPLY_LANGUAGES}
                onChange={(v) => {
                  setAiSettings((prev) =>
                    prev ? { ...prev, replyLanguage: (v || 'auto') as ReplyLanguage } : prev,
                  )
                  setSaveMessage(null)
                }}
              />
            </div>
            <div className="flex items-start justify-between gap-4 border-t border-border/60 pt-5">
              <div className="flex items-start gap-3">
                <MessageSquareText size={16} className="mt-0.5 text-accent" />
                <div>
                  <Label htmlFor="ai-workspace-language" className="text-sm font-medium">
                    {t('ai.communication.workspaceLanguageLabel')}
                  </Label>
                  <p className="text-xs text-text-muted mt-0.5 max-w-sm">
                    {t('ai.communication.workspaceLanguageHint')}
                  </p>
                </div>
              </div>
              <LanguageSelect
                id="ai-workspace-language"
                value={aiSettings.workspaceLanguage}
                languages={WORKSPACE_LANGUAGES}
                onChange={(v) => {
                  setAiSettings((prev) =>
                    prev ? { ...prev, workspaceLanguage: (v || 'en') as WorkspaceLanguage } : prev,
                  )
                  setSaveMessage(null)
                }}
              />
            </div>
            <div className="flex items-start justify-between gap-4 border-t border-border/60 pt-5">
              <div className="flex items-start gap-3">
                <UserRound size={16} className="mt-0.5 text-accent" />
                <div>
                  <Label htmlFor="ai-reply-send-as" className="text-sm font-medium">
                    {t('ai.communication.sendAsLabel')}
                  </Label>
                  <p className="text-xs text-text-muted mt-0.5 max-w-sm">
                    {t('ai.communication.sendAsHint')}
                  </p>
                </div>
              </div>
              <Select
                value={aiSettings.replySendAs}
                onValueChange={(v) => {
                  setAiSettings((prev) =>
                    prev ? { ...prev, replySendAs: v as ReplySendAs } : prev,
                  )
                  setSaveMessage(null)
                }}
              >
                <SelectTrigger id="ai-reply-send-as" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">{t('ai.communication.sendAsUser')}</SelectItem>
                  <SelectItem value="agent">{t('ai.communication.sendAsAgent')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-5 space-y-5">
        <div>
          <h2 className="text-sm font-medium text-text-heading">
            {t('ai.communication.triageTitle')}
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            {t('ai.communication.triageDescription')}
          </p>
        </div>
        {certainty == null ? (
          <LoadingBlock variant="inline" label={t('ai.communication.loadingConfig')} />
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Gauge size={16} className="mt-0.5 text-accent" />
              <div>
                <Label htmlFor="ai-certainty-threshold" className="text-sm font-medium">
                  {t('ai.communication.certaintyLabel')}
                </Label>
                <p className="text-xs text-text-muted mt-0.5 max-w-sm">
                  {t('ai.communication.certaintyHint')}
                </p>
              </div>
            </div>
            <Select
              value={String(certainty)}
              onValueChange={(v) => {
                setCertainty(Number(v))
                setSaveMessage(null)
              }}
            >
              <SelectTrigger id="ai-certainty-threshold" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} — {n <= 3
                      ? t('ai.communication.certaintyLow')
                      : n <= 7
                        ? t('ai.communication.certaintyMedium')
                        : t('ai.communication.certaintyHigh')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </Card>

      <Card className="p-5 space-y-5">
        <div>
          <h2 className="text-sm font-medium text-text-heading">
            {t('ai.communication.mailboxOverrideTitle')}
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            {t('ai.communication.mailboxOverrideDescription')}
          </p>
        </div>
        {mailboxesLoading ? (
          <LoadingBlock variant="inline" label={t('ai.communication.loadingMailboxes')} />
        ) : activeMailboxes.length === 0 ? (
          <EmptyState
            icon={Mail}
            title={t('ai.communication.noMailboxTitle')}
            description={t('ai.communication.noMailboxDescription')}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" variant="secondary" asChild>
                  <Link to="/settings/channels">{t('ai.communication.goToMailboxes')}</Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link to="/settings/setup">{t('ai.communication.openSetup')}</Link>
                </Button>
              </div>
            }
          />
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai-mailbox-select">{t('ai.communication.mailboxLabel')}</Label>
              <Select
                value={connectionId != null ? String(connectionId) : undefined}
                onValueChange={(v) => setConnectionId(Number(v))}
              >
                <SelectTrigger id="ai-mailbox-select" className="max-w-md">
                  <SelectValue placeholder={t('ai.communication.mailboxPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {activeMailboxes.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      <span className="flex items-center gap-2">
                        <ProviderLogo provider={m.provider} className="h-4 w-4 object-contain" />
                        {m.displayName} ({m.mailboxEmail})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {loadError ? <p className="text-xs text-destructive">{loadError}</p> : null}
            {loadingConfig ? (
              <LoadingBlock variant="inline" label={t('ai.communication.loadingConfig')} />
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <p className="text-xs text-text-muted mt-2 max-w-sm">
                    {mailboxMode
                      ? t(`ai.communication.modeHints.${mailboxMode}`)
                      : t(`ai.communication.modeHints.${modes?.email ?? 'suggest'}`)}
                  </p>
                  <ModeSelect
                    id="ai-mode-mailbox"
                    value={mailboxMode}
                    onChange={(v) => {
                      setMailboxMode(v as MailboxAiMode | '')
                      setSaveMessage(null)
                    }}
                    includeDefault
                    defaultLabel={t('ai.communication.useDefault')}
                  />
                </div>
                <div className="flex items-start justify-between gap-4 border-t border-border/60 pt-4">
                  <p className="text-xs text-text-muted mt-2 max-w-sm">
                    {t('ai.communication.mailboxLanguageHint')}
                  </p>
                  <LanguageSelect
                    id="ai-language-mailbox"
                    value={mailboxLanguage}
                    languages={REPLY_LANGUAGES}
                    onChange={(v) => {
                      setMailboxLanguage(v as MailboxReplyLanguage)
                      setSaveMessage(null)
                    }}
                    includeDefault
                    defaultLabel={t('ai.communication.useDefault')}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={() => void handleSave()} disabled={saving || !isDirty}>
          {saving ? t('ai.communication.saving') : t('ai.communication.save')}
        </Button>
        {saveMessage ? <p className="text-xs text-text-secondary">{saveMessage}</p> : null}
      </div>

      <ChannelBindingsPanel />
    </PageContent>
  )
}
