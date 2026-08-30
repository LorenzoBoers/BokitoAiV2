import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Gauge, Globe, Languages, Mail, MessageCircle, MessageSquareText, UserRound } from 'lucide-react'
import { Badge } from '../components/ui/badge'
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
import {
  getAiConfig,
  saveAiConfig,
  type EmailConnection,
  type MailboxAiMode,
  type MailboxReplyLanguage,
} from '../lib/email-api'
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
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard'
import { cn } from '../lib/utils'

const MODES: AiMode[] = ['suggest', 'auto', 'off']
const REPLY_LANGUAGES: ReplyLanguage[] = ['auto', 'nl', 'en', 'de', 'fr', 'es']
const WORKSPACE_LANGUAGES: WorkspaceLanguage[] = ['nl', 'en', 'de', 'fr', 'es']

type MailboxOverrideDraft = {
  mode: MailboxAiMode | ''
  replyLanguage: MailboxReplyLanguage
}

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

function hasOverride(draft: MailboxOverrideDraft | undefined): boolean {
  if (!draft) return false
  return Boolean(draft.mode) || Boolean(draft.replyLanguage)
}

function overridesEqual(a: MailboxOverrideDraft | undefined, b: MailboxOverrideDraft | undefined): boolean {
  return (a?.mode ?? '') === (b?.mode ?? '') && (a?.replyLanguage ?? '') === (b?.replyLanguage ?? '')
}

export default function AiCommunicationSettings() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const { activeConnections: activeMailboxes, loading: mailboxesLoading } = useMailboxConnections()

  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null)
  const [savedAiSettings, setSavedAiSettings] = useState<AiSettings | null>(null)
  const [modesError, setModesError] = useState<string | null>(null)

  const [certainty, setCertainty] = useState<number | null>(null)
  const [savedCertainty, setSavedCertainty] = useState<number | null>(null)

  const [mailboxDrafts, setMailboxDrafts] = useState<Record<number, MailboxOverrideDraft>>({})
  const [savedMailboxDrafts, setSavedMailboxDrafts] = useState<Record<number, MailboxOverrideDraft>>({})
  const [loadingMailboxConfigs, setLoadingMailboxConfigs] = useState(false)
  const [mailboxLoadError, setMailboxLoadError] = useState<string | null>(null)
  const [expandedMailboxId, setExpandedMailboxId] = useState<number | null>(null)

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

  const mailboxIdsKey = useMemo(
    () => activeMailboxes.map((mailbox) => mailbox.id).join(','),
    [activeMailboxes],
  )

  useEffect(() => {
    if (!token || mailboxesLoading) return
    if (!mailboxIdsKey) {
      setMailboxDrafts({})
      setSavedMailboxDrafts({})
      setExpandedMailboxId(null)
      setMailboxLoadError(null)
      setLoadingMailboxConfigs(false)
      return
    }

    const mailboxIds = mailboxIdsKey.split(',').map(Number)
    let cancelled = false
    setLoadingMailboxConfigs(true)
    setMailboxLoadError(null)

    void Promise.all(
      mailboxIds.map(async (id) => {
        const config = await getAiConfig(token, id)
        return [id, { mode: config.mode, replyLanguage: config.replyLanguage }] as const
      }),
    )
      .then((rows) => {
        if (cancelled) return
        const next: Record<number, MailboxOverrideDraft> = {}
        for (const [id, draft] of rows) next[id] = draft
        setMailboxDrafts(next)
        setSavedMailboxDrafts(next)
        setExpandedMailboxId((prev) => (prev != null && mailboxIds.includes(prev) ? prev : null))
      })
      .catch((err) => {
        if (!cancelled) {
          setMailboxLoadError(err instanceof Error ? err.message : t('ai.communication.loadError'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingMailboxConfigs(false)
      })

    return () => {
      cancelled = true
    }
  }, [token, mailboxesLoading, mailboxIdsKey, t])

  const dirtyMailboxIds = useMemo(() => {
    const ids = new Set<number>()
    for (const mailbox of activeMailboxes) {
      if (!overridesEqual(mailboxDrafts[mailbox.id], savedMailboxDrafts[mailbox.id])) {
        ids.add(mailbox.id)
      }
    }
    return ids
  }, [activeMailboxes, mailboxDrafts, savedMailboxDrafts])

  const customMailboxCount = useMemo(
    () => activeMailboxes.filter((mailbox) => hasOverride(mailboxDrafts[mailbox.id])).length,
    [activeMailboxes, mailboxDrafts],
  )

  const tenantDirty =
    aiSettings != null &&
    savedAiSettings != null &&
    JSON.stringify(aiSettings) !== JSON.stringify(savedAiSettings)
  const mailboxDirty = dirtyMailboxIds.size > 0
  const certaintyDirty = certainty != null && certainty !== savedCertainty
  const isDirty = tenantDirty || mailboxDirty || certaintyDirty
  useUnsavedChangesGuard(isDirty, t('ai.communication.unsavedLeave'))

  const updateMailboxDraft = useCallback((mailboxId: number, patch: Partial<MailboxOverrideDraft>) => {
    setMailboxDrafts((prev) => {
      const current = prev[mailboxId] ?? { mode: '', replyLanguage: '' as MailboxReplyLanguage }
      return { ...prev, [mailboxId]: { ...current, ...patch } }
    })
    setSaveMessage(null)
  }, [])

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
        resetTenantDefaultSendAs()
      }
      if (mailboxDirty) {
        const saves = Array.from(dirtyMailboxIds).map(async (id) => {
          const draft = mailboxDrafts[id] ?? { mode: '', replyLanguage: '' as MailboxReplyLanguage }
          await saveAiConfig(token, id, { mode: draft.mode, replyLanguage: draft.replyLanguage })
          return [id, draft] as const
        })
        const savedRows = await Promise.all(saves)
        setSavedMailboxDrafts((prev) => {
          const next = { ...prev }
          for (const [id, draft] of savedRows) next[id] = draft
          return next
        })
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
  }, [
    token,
    aiSettings,
    tenantDirty,
    mailboxDirty,
    dirtyMailboxIds,
    mailboxDrafts,
    certaintyDirty,
    certainty,
    t,
  ])

  const effectiveModeLabel = (draft: MailboxOverrideDraft | undefined) => {
    const mode = draft?.mode || modes?.email || 'suggest'
    return t(`ai.communication.modeOptions.${mode}`)
  }

  const effectiveLanguageLabel = (draft: MailboxOverrideDraft | undefined) => {
    const language = draft?.replyLanguage || aiSettings?.replyLanguage || 'auto'
    return t(`ai.communication.languageOptions.${language}`)
  }

  return (
    <PageContent width="md" className="space-y-6">
      <PageIntro description={t('ai.pageMeta.communication.description')} />
      {modes ? (
        <p className="text-xs text-text-muted">
          {t('ai.communication.currentSetup', {
            email: t(`ai.communication.modeOptions.${modes.email}`),
            widget: t(`ai.communication.modeOptions.${modes.widget}`),
            other: t(`ai.communication.modeOptions.${modes.whatsapp}`),
          })}
        </p>
      ) : null}

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

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-medium text-text-heading">
            {t('ai.communication.workspaceDefaultsTitle')}
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            {t('ai.communication.workspaceDefaultsDescription')}
          </p>
        </div>

        <Card className="p-5 space-y-5">
          <div>
            <h3 className="text-sm font-medium text-text-heading">
              {t('ai.communication.howAiRespondsTitle')}
            </h3>
            <p className="text-xs text-text-muted mt-0.5">
              {t('ai.communication.howAiRespondsDescription')}
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
                    {customMailboxCount > 0 ? (
                      <p className="text-xs text-text-secondary mt-1.5">
                        {t('ai.communication.mailboxExceptionsSummary', { count: customMailboxCount })}
                      </p>
                    ) : null}
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
            <h3 className="text-sm font-medium text-text-heading">
              {t('ai.communication.languageTitle')}
            </h3>
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
            </div>
          )}
        </Card>

        <Card className="p-5 space-y-5">
          <div>
            <h3 className="text-sm font-medium text-text-heading">
              {t('ai.communication.sendAndTriageTitle')}
            </h3>
            <p className="text-xs text-text-muted mt-0.5">
              {t('ai.communication.sendAndTriageDescription')}
            </p>
          </div>
          {!aiSettings || certainty == null ? (
            <LoadingBlock variant="inline" label={t('ai.communication.loadingConfig')} />
          ) : (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-4">
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
              <div className="flex items-start justify-between gap-4 border-t border-border/60 pt-5">
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
                        {n} —{' '}
                        {n <= 3
                          ? t('ai.communication.certaintyLow')
                          : n <= 7
                            ? t('ai.communication.certaintyMedium')
                            : t('ai.communication.certaintyHigh')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </Card>
      </section>

      <Card className="p-5 space-y-5">
        <div>
          <h2 className="text-sm font-medium text-text-heading">
            {t('ai.communication.mailboxExceptionsTitle')}
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            {t('ai.communication.mailboxExceptionsDescription')}
          </p>
        </div>
        {mailboxesLoading || loadingMailboxConfigs ? (
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
          <div className="space-y-2">
            {mailboxLoadError ? <p className="text-xs text-destructive">{mailboxLoadError}</p> : null}
            {activeMailboxes.map((mailbox) => (
              <MailboxExceptionRow
                key={mailbox.id}
                mailbox={mailbox}
                draft={mailboxDrafts[mailbox.id]}
                expanded={expandedMailboxId === mailbox.id}
                isCustom={hasOverride(mailboxDrafts[mailbox.id])}
                effectiveMode={effectiveModeLabel(mailboxDrafts[mailbox.id])}
                effectiveLanguage={effectiveLanguageLabel(mailboxDrafts[mailbox.id])}
                onToggle={() =>
                  setExpandedMailboxId((prev) => (prev === mailbox.id ? null : mailbox.id))
                }
                onModeChange={(value) => updateMailboxDraft(mailbox.id, { mode: value as MailboxAiMode | '' })}
                onLanguageChange={(value) =>
                  updateMailboxDraft(mailbox.id, { replyLanguage: value as MailboxReplyLanguage })
                }
                customBadge={t('ai.communication.customBadge')}
                useDefaultLabel={t('ai.communication.useDefault')}
                modeHint={
                  mailboxDrafts[mailbox.id]?.mode
                    ? t(`ai.communication.modeHints.${mailboxDrafts[mailbox.id].mode}`)
                    : t(`ai.communication.modeHints.${modes?.email ?? 'suggest'}`)
                }
                languageHint={t('ai.communication.mailboxLanguageHint')}
              />
            ))}
          </div>
        )}
      </Card>

      <div
        className={
          isDirty
            ? 'sticky bottom-4 z-20 flex items-center gap-3 rounded-xl border border-accent/30 bg-bg-surface px-3 py-2 shadow-overlay'
            : 'flex items-center gap-3'
        }
      >
        {isDirty ? <p className="text-xs text-text-secondary">{t('ai.communication.unsavedBar')}</p> : null}
        <Button size="sm" onClick={() => void handleSave()} disabled={saving || !isDirty}>
          {saving ? t('ai.communication.saving') : t('ai.communication.save')}
        </Button>
        {saveMessage ? <p className="text-xs text-text-secondary">{saveMessage}</p> : null}
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-medium text-text-heading">
            {t('ai.communication.whoAnswersTitle')}
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            {t('ai.communication.whoAnswersDescription')}
          </p>
        </div>
        <ChannelBindingsPanel />
      </section>
    </PageContent>
  )
}

function MailboxExceptionRow({
  mailbox,
  draft,
  expanded,
  isCustom,
  effectiveMode,
  effectiveLanguage,
  onToggle,
  onModeChange,
  onLanguageChange,
  customBadge,
  useDefaultLabel,
  modeHint,
  languageHint,
}: {
  mailbox: EmailConnection
  draft: MailboxOverrideDraft | undefined
  expanded: boolean
  isCustom: boolean
  effectiveMode: string
  effectiveLanguage: string
  onToggle: () => void
  onModeChange: (value: string) => void
  onLanguageChange: (value: string) => void
  customBadge: string
  useDefaultLabel: string
  modeHint: string
  languageHint: string
}) {
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-bg-hover/40 transition-colors"
        aria-expanded={expanded}
      >
        <ProviderLogo provider={mailbox.provider} className="h-5 w-5 object-contain shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-text-heading truncate">
              {mailbox.displayName || mailbox.mailboxEmail}
            </p>
            {isCustom ? (
              <Badge variant="accent" className="rounded-md px-1.5 py-0.5 text-[10px] font-medium">
                {customBadge}
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-text-muted truncate">{mailbox.mailboxEmail}</p>
          <p className="text-xs text-text-secondary mt-1">
            {effectiveMode} · {effectiveLanguage}
          </p>
        </div>
        <ChevronDown
          size={16}
          className={cn('shrink-0 text-text-muted transition-transform', expanded && 'rotate-180')}
        />
      </button>
      {expanded ? (
        <div className="space-y-4 border-t border-border/60 bg-bg-elevated/30 px-3 py-4">
          <div className="flex items-start justify-between gap-4">
            <p className="text-xs text-text-muted mt-2 max-w-sm">{modeHint}</p>
            <ModeSelect
              id={`ai-mode-mailbox-${mailbox.id}`}
              value={draft?.mode ?? ''}
              onChange={onModeChange}
              includeDefault
              defaultLabel={useDefaultLabel}
            />
          </div>
          <div className="flex items-start justify-between gap-4 border-t border-border/60 pt-4">
            <p className="text-xs text-text-muted mt-2 max-w-sm">{languageHint}</p>
            <LanguageSelect
              id={`ai-language-mailbox-${mailbox.id}`}
              value={draft?.replyLanguage ?? ''}
              languages={REPLY_LANGUAGES}
              onChange={onLanguageChange}
              includeDefault
              defaultLabel={useDefaultLabel}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
