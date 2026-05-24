import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bot, Mail } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { EmptyState } from '../components/ui/empty-state'
import { LoadingBlock } from '../components/ui/loading-block'
import { Label } from '../components/ui/label'
import { Switch } from '../components/ui/switch'
import PageContent from '../components/layout/PageContent'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import ProviderLogo from '../components/email/ProviderLogo'
import { useAuth } from '../context/AuthContext'
import { useMailboxConnections } from '../hooks/useMailboxConnections'
import {
  getAiConfig,
  saveAiConfig,
  type AiInboxConfig,
} from '../lib/email-api'

const TONE_OPTIONS: AiInboxConfig['tone'][] = ['formeel', 'informeel', 'match']
const LANGUAGE_OPTIONS: AiInboxConfig['language'][] = ['nl', 'en', 'auto']

export default function AiCommunicationSettings() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const { activeConnections: activeMailboxes, loading: mailboxesLoading } = useMailboxConnections()

  const [connectionId, setConnectionId] = useState<number | null>(null)
  const [config, setConfig] = useState<AiInboxConfig | null>(null)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

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
    if (!token || connectionId == null) {
      setConfig(null)
      return
    }
    let cancelled = false
    setLoadingConfig(true)
    setLoadError(null)
    void getAiConfig(token, connectionId)
      .then((data) => {
        if (!cancelled) setConfig(data)
      })
      .catch((err) => {
        if (!cancelled) {
          setConfig(null)
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

  const patchConfig = useCallback((patch: Partial<AiInboxConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev))
    setSaveMessage(null)
  }, [])

  const handleSave = useCallback(async () => {
    if (!token || connectionId == null || !config) return
    setSaving(true)
    setSaveMessage(null)
    try {
      await saveAiConfig(token, connectionId, config)
      setSaveMessage(t('ai.communication.saved'))
    } catch (err) {
      setSaveMessage(
        err instanceof Error ? err.message : t('ai.communication.saveError'),
      )
    } finally {
      setSaving(false)
    }
  }, [token, connectionId, config, t])

  const selectedMailbox = activeMailboxes.find((m) => m.id === connectionId)

  return (
    <PageContent width="md" className="space-y-6">
      <p className="text-sm text-text-secondary">{t('ai.pageMeta.communication.description')}</p>

      {mailboxesLoading ? (
        <LoadingBlock variant="inline" label={t('ai.communication.loadingMailboxes')} />
      ) : activeMailboxes.length === 0 ? (
        <EmptyState
          icon={Mail}
          title={t('ai.communication.noMailboxTitle')}
          description={t('ai.communication.noMailboxDescription')}
          action={
            <Button size="sm" variant="secondary" asChild>
              <Link to="/settings/inbox">{t('ai.communication.goToMailboxes')}</Link>
            </Button>
          }
        />
      ) : (
        <>
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

          {loadError ? (
            <p className="text-xs text-destructive">{loadError}</p>
          ) : null}

          {loadingConfig || !config ? (
            <LoadingBlock variant="inline" label={t('ai.communication.loadingConfig')} />
          ) : (
            <Card className="p-5 space-y-6">
              <div className="flex items-center gap-2 text-sm font-medium text-text-heading">
                <Bot size={16} className="text-accent" />
                {selectedMailbox?.displayName ?? t('ai.communication.mailboxLabel')}
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    {t('ai.communication.suggestionsEnabled')}
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {t('ai.communication.suggestionsEnabledHint')}
                  </p>
                </div>
                <Switch
                  checked={config.suggestions_enabled}
                  onCheckedChange={(checked) => patchConfig({ suggestions_enabled: checked })}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    {t('ai.communication.autoLabelEnabled')}
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {t('ai.communication.autoLabelEnabledHint')}
                  </p>
                </div>
                <Switch
                  checked={config.auto_label_enabled}
                  onCheckedChange={(checked) => patchConfig({ auto_label_enabled: checked })}
                />
              </div>

              <div className="flex items-center justify-between gap-4 border-t border-border/50 pt-5">
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    {t('ai.communication.autoReplyEnabled')}
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {t('ai.communication.autoReplyEnabledHint')}
                  </p>
                </div>
                <Switch
                  checked={config.auto_reply_enabled}
                  onCheckedChange={(checked) => patchConfig({ auto_reply_enabled: checked })}
                />
              </div>

              {config.auto_reply_enabled ? (
                <div className="space-y-2 pl-1">
                  <Label htmlFor="auto-reply-threshold">
                    {t('ai.communication.autoReplyThreshold')}
                  </Label>
                  <Select
                    value={String(config.auto_reply_threshold)}
                    onValueChange={(v) =>
                      patchConfig({ auto_reply_threshold: Number.parseFloat(v) })
                    }
                  >
                    <SelectTrigger id="auto-reply-threshold" className="max-w-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[0.7, 0.75, 0.8, 0.85, 0.9, 0.95].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {Math.round(n * 100)}%
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2 border-t border-border/50 pt-5">
                <div className="space-y-2">
                  <Label>{t('ai.communication.tone')}</Label>
                  <Select
                    value={config.tone}
                    onValueChange={(v) => patchConfig({ tone: v as AiInboxConfig['tone'] })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TONE_OPTIONS.map((tone) => (
                        <SelectItem key={tone} value={tone}>
                          {t(`ai.communication.toneOptions.${tone}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('ai.communication.language')}</Label>
                  <Select
                    value={config.language}
                    onValueChange={(v) =>
                      patchConfig({ language: v as AiInboxConfig['language'] })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGE_OPTIONS.map((lang) => (
                        <SelectItem key={lang} value={lang}>
                          {t(`ai.communication.languageOptions.${lang}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
                  {saving ? t('ai.communication.saving') : t('ai.communication.save')}
                </Button>
                {saveMessage ? (
                  <p className="text-xs text-text-secondary">{saveMessage}</p>
                ) : null}
              </div>
            </Card>
          )}
        </>
      )}
    </PageContent>
  )
}
