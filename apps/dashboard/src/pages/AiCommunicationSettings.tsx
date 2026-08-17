import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Globe, Languages, Mail, MessageSquareText } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { EmptyState } from '../components/ui/empty-state'
import { LoadingBlock } from '../components/ui/loading-block'
import { Label } from '../components/ui/label'
import PageContent from '../components/layout/PageContent'
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
  saveAiCommunicationSettings,
  type AiCommunicationSettings as AiSettings,
  type AiMode,
  type ChannelAiModes,
  type ReplyLanguage,
  type WorkspaceLanguage,
} from '../lib/inbox-api'

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
  const isDirty = tenantDirty || mailboxDirty

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
        })
        setSavedAiSettings(aiSettings)
      }
      if (connectionId != null && mailboxDirty) {
        await saveAiConfig(token, connectionId, { mode: mailboxMode, replyLanguage: mailboxLanguage })
        setSavedMailboxMode(mailboxMode)
        setSavedMailboxLanguage(mailboxLanguage)
      }
      setSaveMessage(t('ai.communication.saved'))
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : t('ai.communication.saveError'))
    } finally {
      setSaving(false)
    }
  }, [token, aiSettings, tenantDirty, connectionId, mailboxDirty, mailboxMode, mailboxLanguage, t])

  return (
    <PageContent width="md" className="space-y-6">
      <p className="text-sm text-text-secondary">{t('ai.pageMeta.communication.description')}</p>

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
            <div className="flex items-start justify-between gap-4 border-t border-border/50 pt-5">
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
            <div className="flex items-start justify-between gap-4 border-t border-border/50 pt-5">
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
              <Button size="sm" variant="secondary" asChild>
                <Link to="/settings/channels">{t('ai.communication.goToMailboxes')}</Link>
              </Button>
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
                <div className="flex items-start justify-between gap-4 border-t border-border/50 pt-4">
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
