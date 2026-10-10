import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ChevronDown,
  Gauge,
  Languages,
  Mail,
  MessageSquareText,
  Pause,
  Play,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  UserRoundCheck,
  X,
} from 'lucide-react'
import { AutosaveStatus } from '../components/ui/AutosaveStatus'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { useAutosave } from '../hooks/useAutosave'
import { EmptyState } from '../components/ui/empty-state'
import { Input } from '../components/ui/input'
import { LoadingBlock } from '../components/ui/loading-block'
import { Label } from '../components/ui/label'
import { Switch } from '../components/ui/switch'
import PageContent from '../components/layout/PageContent'
import { PageIntro } from '../components/layout/PageIntro'
import { PageRelatedLinks } from '../components/layout/PageRelatedLinks'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import ProviderLogo from '../components/email/ProviderLogo'
import AiHandlingPicker from '../components/ai/AiHandlingPicker'
import { AiHandlingIcon } from '../components/ai/AiHandlingIcon'
import { ChannelGlyph } from '../components/ui/ChannelGlyph'
import { useAuth } from '../context/AuthContext'
import { useMailboxConnections } from '../hooks/useMailboxConnections'
import { confirmAutonomousRaise } from '../hooks/useAiHandling'
import { useConfirm } from '../components/ui/confirm-dialog'
import { getAiConfig, saveAiConfig, type EmailConnection, type MailboxReplyLanguage } from '../lib/email-api'
import {
  getAiCommunicationSettings,
  saveAiCommunicationSettings,
  type AiCommunicationSettings as AiSettings,
  type ReplyLanguage,
  type ReplySendAs,
  type WorkspaceLanguage,
} from '../lib/inbox-api'
import type { AiHandlingMode, AiHandlingScope } from '../lib/ai-handling'
import {
  getAiHandlingOverview,
  resetAiBreaker,
  saveAiHandlingSettings,
  setAiHandling,
  type AiHandlingBreaker,
  type AiHandlingDisclosure,
  type AiHandlingException,
  type AiHandlingOverview,
  type AiHandlingSafeguards,
} from '../lib/ai-handling-api'
import { getAllowances, updateAllowances, type AllowanceMode } from '../lib/govern-api'
import { listCategories, patchCategory, type CategoryRow } from '../lib/tickets-api'
import { Hashtag } from '../components/ui/HashtagMark'
import { resetTenantDefaultSendAs } from '../lib/reply-send-as'
import { WEBSITE_WIDGET_CUSTOMIZE_PATH } from '../lib/assistant-settings-path'
import { inboxPath } from '../lib/messages-paths'
import { cn } from '../lib/utils'

const REPLY_LANGUAGES: ReplyLanguage[] = ['auto', 'nl', 'en', 'de', 'fr', 'es']
const WORKSPACE_LANGUAGES: WorkspaceLanguage[] = ['nl', 'en', 'de', 'fr', 'es']
const GOVERN_POLICY_PATH = '/settings/govern?tab=policy'

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

function SettingRow({
  icon: Icon,
  htmlFor,
  label,
  hint,
  children,
  first = false,
}: {
  icon: typeof Mail
  htmlFor: string
  label: string
  hint: string
  children: ReactNode
  first?: boolean
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4', !first && 'border-t border-border/60 pt-5')}>
      <div className="flex items-start gap-3">
        <Icon size={16} className="mt-0.5 text-accent" />
        <div>
          <Label htmlFor={htmlFor} className="text-sm font-medium">
            {label}
          </Label>
          <p className="mt-0.5 max-w-sm text-xs text-text-muted">{hint}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

type ExceptionGroup = { scope: AiHandlingScope; rows: AiHandlingException[] }

function exceptionHref(scope: AiHandlingScope, row: AiHandlingException): string {
  if (scope === 'contact') return `/contacts/${row.id}`
  if (scope === 'conversation') return inboxPath('open', row.id)
  return '/settings/channels'
}

export default function AiCommunicationSettings() {
  const { t } = useTranslation('nav')
  const { t: tc } = useTranslation('common')
  const { token } = useAuth()
  const confirm = useConfirm()
  const { activeConnections: activeMailboxes, loading: mailboxesLoading } = useMailboxConnections()

  const [overview, setOverview] = useState<AiHandlingOverview | null>(null)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [handlingSaving, setHandlingSaving] = useState(false)

  const [safeguards, setSafeguards] = useState<AiHandlingSafeguards | null>(null)
  const [breaker, setBreaker] = useState<AiHandlingBreaker | null>(null)
  const [disclosure, setDisclosure] = useState<AiHandlingDisclosure | null>(null)
  const [messagingMode, setMessagingMode] = useState<AllowanceMode | null>(null)
  const [messagingBusy, setMessagingBusy] = useState(false)
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [busyTypeId, setBusyTypeId] = useState<string | null>(null)

  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null)
  const [savedAiSettings, setSavedAiSettings] = useState<AiSettings | null>(null)

  const [mailboxDrafts, setMailboxDrafts] = useState<Record<number, MailboxReplyLanguage>>({})
  const [savedMailboxDrafts, setSavedMailboxDrafts] = useState<Record<number, MailboxReplyLanguage>>({})
  const [loadingMailboxConfigs, setLoadingMailboxConfigs] = useState(false)
  const [mailboxLoadError, setMailboxLoadError] = useState<string | null>(null)
  const [expandedMailboxId, setExpandedMailboxId] = useState<number | null>(null)


  const applyOverview = useCallback((next: AiHandlingOverview) => {
    setOverview(next)
    setSafeguards(next.safeguards)
    setBreaker(next.breaker)
    setDisclosure(next.disclosure)
  }, [])

  const loadOverview = useCallback(async () => {
    if (!token) return
    try {
      applyOverview(await getAiHandlingOverview(token))
      setOverviewError(null)
    } catch (err) {
      setOverviewError(err instanceof Error ? err.message : t('ai.communication.loadError'))
    }
  }, [token, t, applyOverview])

  const loadGovernCeiling = useCallback(async () => {
    try {
      const allowances = await getAllowances()
      setMessagingMode(allowances.allowances.messaging ?? 'allow')
    } catch {
      setMessagingMode(null)
    }
  }, [])

  const loadCategories = useCallback(async () => {
    try {
      setCategories(await listCategories())
    } catch {
      setCategories([])
    }
  }, [])

  useEffect(() => {
    void loadOverview()
    void loadGovernCeiling()
    void loadCategories()
  }, [loadOverview, loadGovernCeiling, loadCategories])

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
      mailboxIds.map(async (id) => [id, (await getAiConfig(token, id)).replyLanguage] as const),
    )
      .then((rows) => {
        if (cancelled) return
        const next: Record<number, MailboxReplyLanguage> = {}
        for (const [id, language] of rows) next[id] = language
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

  const dirtyMailboxIds = useMemo(
    () =>
      activeMailboxes
        .filter((mailbox) => (mailboxDrafts[mailbox.id] ?? '') !== (savedMailboxDrafts[mailbox.id] ?? ''))
        .map((mailbox) => mailbox.id),
    [activeMailboxes, mailboxDrafts, savedMailboxDrafts],
  )

  const tenantDirty =
    aiSettings != null &&
    savedAiSettings != null &&
    JSON.stringify(aiSettings) !== JSON.stringify(savedAiSettings)
  const safeguardsDirty =
    overview != null && safeguards != null && JSON.stringify(safeguards) !== JSON.stringify(overview.safeguards)
  const breakerDirty =
    overview != null && breaker != null && JSON.stringify(breaker) !== JSON.stringify(overview.breaker)
  const disclosureDirty =
    overview != null && disclosure != null && JSON.stringify(disclosure) !== JSON.stringify(overview.disclosure)
  const mailboxDirty = dirtyMailboxIds.length > 0
  const isDirty = tenantDirty || safeguardsDirty || breakerDirty || disclosureDirty || mailboxDirty

  const autonomousPaused = messagingMode === 'ask' || messagingMode === 'deny'

  const toggleAutonomousPause = async () => {
    if (messagingMode == null || messagingBusy) return
    setMessagingBusy(true)
    try {
      const next: AllowanceMode = autonomousPaused ? 'allow' : 'ask'
      await updateAllowances({ messaging: next })
      setMessagingMode(next)
      await loadOverview()
      toast.success(
        autonomousPaused
          ? t('ai.communication.resumeAutonomousSaved')
          : t('ai.communication.pauseAutonomousSaved'),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('ai.communication.saveError'))
    } finally {
      setMessagingBusy(false)
    }
  }

  const toggleSendMode = async (row: CategoryRow, reviewed: boolean) => {
    setBusyTypeId(row.id)
    try {
      const updated = await patchCategory(row.id, { send_mode: reviewed ? 'draft' : 'send' })
      setCategories((current) => current.map((item) => (item.id === row.id ? { ...item, send_mode: updated.send_mode } : item)))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tc('aiHandling.saveError'))
    } finally {
      setBusyTypeId(null)
    }
  }

  const resumeBreaker = async (accountId: string) => {
    if (!token) return
    try {
      await resetAiBreaker(token, accountId)
      await loadOverview()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tc('aiHandling.saveError'))
    }
  }

  const changeWorkspaceMode = async (mode: AiHandlingMode | null) => {
    if (!token || !mode) return
    if (mode === 'autonomous' && overview?.workspace.effective !== 'autonomous') {
      if (!(await confirmAutonomousRaise(token, 'workspace', 'current', tc, confirm))) return
    }
    setHandlingSaving(true)
    try {
      await setAiHandling(token, 'workspace', 'current', mode)
      await loadOverview()
      toast.success(tc('aiHandling.changed', { mode: tc(`aiHandling.modes.${mode}.label`) }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tc('aiHandling.saveError'))
    } finally {
      setHandlingSaving(false)
    }
  }

  const clearException = async (scope: AiHandlingScope, row: AiHandlingException) => {
    if (!token) return
    try {
      await setAiHandling(token, scope, row.id, null)
      await loadOverview()
      toast.success(tc('aiHandling.cleared', { source: tc('aiHandling.sources.workspace') }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tc('aiHandling.saveError'))
    }
  }

  const handleSave = useCallback(async () => {
    if (!token) return
    try {
      if (safeguardsDirty || breakerDirty || disclosureDirty) {
        applyOverview(
          await saveAiHandlingSettings(token, {
            ...(safeguardsDirty && safeguards ? { safeguards } : {}),
            ...(breakerDirty && breaker ? { breaker } : {}),
            ...(disclosureDirty && disclosure ? { disclosure } : {}),
          }),
        )
      }
      if (tenantDirty && aiSettings) {
        await saveAiCommunicationSettings(token, aiSettings)
        setSavedAiSettings(aiSettings)
        resetTenantDefaultSendAs()
      }
      if (mailboxDirty) {
        await Promise.all(
          dirtyMailboxIds.map((id) => saveAiConfig(token, id, { replyLanguage: mailboxDrafts[id] ?? '' })),
        )
        setSavedMailboxDrafts((prev) => {
          const next = { ...prev }
          for (const id of dirtyMailboxIds) next[id] = mailboxDrafts[id] ?? ''
          return next
        })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('ai.communication.saveError'))
      throw err
    }
  }, [
    token,
    safeguardsDirty,
    breakerDirty,
    disclosureDirty,
    safeguards,
    breaker,
    disclosure,
    tenantDirty,
    aiSettings,
    mailboxDirty,
    dirtyMailboxIds,
    mailboxDrafts,
    applyOverview,
    resetTenantDefaultSendAs,
    t,
  ])

  const { phase, lastSavedAt, error: autosaveError } = useAutosave({
    dirty: isDirty,
    enabled: Boolean(token),
    save: handleSave,
    delayMs: 900,
  })

  const exceptionGroups: ExceptionGroup[] = overview
    ? ([
        { scope: 'channel', rows: overview.exceptions.channels },
        { scope: 'contact', rows: overview.exceptions.contacts },
        { scope: 'conversation', rows: overview.exceptions.conversations },
      ] satisfies ExceptionGroup[]).filter((group) => group.rows.length > 0)
    : []

  const effectiveLanguageLabel = (language: MailboxReplyLanguage | undefined) =>
    t(`ai.communication.languageOptions.${language || aiSettings?.replyLanguage || 'auto'}`)

  return (
    <PageContent width="md" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageIntro description={t('ai.pageMeta.communication.description')} />
        <AutosaveStatus phase={phase} lastSavedAt={lastSavedAt} error={autosaveError} />
      </div>

      <section className="space-y-4" data-testid="ai-handling-settings">
        <div>
          <h2 className="text-base font-medium text-text-heading">{tc('aiHandling.title')}</h2>
          <p className="mt-0.5 text-xs text-text-muted">{t('ai.communication.handlingDescription')}</p>
        </div>

        <Card className="space-y-4 p-5">
          <div>
            <h3 className="text-sm font-medium text-text-heading">
              {t('ai.communication.workspaceDefaultTitle')}
            </h3>
            <p className="mt-0.5 text-xs text-text-muted">{t('ai.communication.workspaceDefaultDescription')}</p>
          </div>
          {overviewError ? <p className="text-xs text-destructive">{overviewError}</p> : null}
          {!overview ? (
            <LoadingBlock variant="inline" label={t('ai.communication.loadingConfig')} />
          ) : (
            <>
              <AiHandlingPicker
                variant="cards"
                scope="workspace"
                handling={overview.workspace}
                canRaise={overview.canRaise}
                saving={handlingSaving}
                onChange={changeWorkspaceMode}
                testId="workspace-ai-handling"
              />
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <AiHandlingIcon mode={overview.ceiling} size={16} className="mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-heading">
                      {t('ai.communication.ceiling', {
                        mode: tc(`aiHandling.modes.${overview.ceiling}.label`),
                      })}
                    </p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {overview.clampedBy
                        ? tc(`aiHandling.clamped.${overview.clampedBy}`, {
                            mode: tc(`aiHandling.modes.${overview.ceiling}.label`),
                          })
                        : t('ai.communication.ceilingHint')}
                    </p>
                    <p className="mt-1 flex items-start gap-1.5 text-xs text-text-muted">
                      <ShieldCheck size={12} className="mt-0.5 shrink-0" />
                      <span>
                        {t('ai.communication.governNote')}{' '}
                        <Link to={GOVERN_POLICY_PATH} className="font-medium text-accent hover:underline">
                          {t('ai.communication.crossLinks.govern')}
                        </Link>
                      </span>
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={autonomousPaused ? 'secondary' : 'outline'}
                  disabled={messagingBusy || messagingMode == null}
                  onClick={() => void toggleAutonomousPause()}
                  data-testid="ai-handling-pause"
                >
                  {autonomousPaused ? <Play size={13} /> : <Pause size={13} />}
                  {autonomousPaused
                    ? t('ai.communication.resumeAutonomous')
                    : t('ai.communication.pauseAutonomous')}
                </Button>
              </div>
            </>
          )}
        </Card>

        <Card className="space-y-4 p-5" data-testid="ai-handling-exceptions">
          <div>
            <h3 className="text-sm font-medium text-text-heading">{t('ai.communication.exceptionsTitle')}</h3>
            <p className="mt-0.5 text-xs text-text-muted">{t('ai.communication.exceptionsDescription')}</p>
          </div>
          {!overview ? (
            <LoadingBlock variant="inline" label={t('ai.communication.loadingConfig')} />
          ) : exceptionGroups.length === 0 ? (
            <p className="text-xs text-text-secondary">{t('ai.communication.exceptionsEmpty')}</p>
          ) : (
            <div className="space-y-4">
              {exceptionGroups.map((group) => (
                <div key={group.scope}>
                  <h4 className="mb-1.5 text-xs font-semibold text-text-muted">
                    {t(`ai.communication.exceptionGroups.${group.scope}`)}
                  </h4>
                  <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
                    {group.rows.map((row) => (
                      <li key={row.id} className="flex items-center gap-2.5 px-3 py-2">
                        {row.mode ? <AiHandlingIcon mode={row.mode} size={14} /> : null}
                        {row.channel ? (
                          <ChannelGlyph channel={row.channel} size={13} className="shrink-0 text-text-muted" />
                        ) : null}
                        <Link
                          to={exceptionHref(group.scope, row)}
                          className="min-w-0 flex-1 truncate-fade text-sm text-text-primary hover:text-accent"
                        >
                          {row.label || row.contactName || row.address || row.id}
                        </Link>
                        {row.breakerTrippedAt ? (
                          <>
                            <Badge variant="warning" className="gap-1 px-1.5 py-0 text-2xs">
                              <ShieldAlert size={10} />
                              {tc('aiHandling.breakerBadge')}
                            </Badge>
                            {group.scope === 'channel' ? (
                              <Button size="sm" variant="outline" onClick={() => void resumeBreaker(row.id)}>
                                {tc('aiHandling.breakerResume')}
                              </Button>
                            ) : null}
                          </>
                        ) : null}
                        {row.mode ? (
                          <span className="shrink-0 text-xs text-text-secondary">
                            {tc(`aiHandling.modes.${row.mode}.label`)}
                          </span>
                        ) : null}
                        {row.reason ? (
                          <span className="hidden shrink-0 text-xs text-text-muted sm:inline">
                            {tc(`aiHandling.reasons.${row.reason}`, { defaultValue: '' })}
                          </span>
                        ) : null}
                        {row.mode ? (
                          <button
                            type="button"
                            onClick={() => void clearException(group.scope, row)}
                            title={t('ai.communication.exceptionClear')}
                            aria-label={t('ai.communication.exceptionClear')}
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-muted hover:bg-bg-hover hover:text-text-primary"
                          >
                            <X size={13} />
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="space-y-5 p-5">
          <div>
            <h3 className="text-sm font-medium text-text-heading">{t('ai.communication.safeguardsTitle')}</h3>
            <p className="mt-0.5 text-xs text-text-muted">{t('ai.communication.safeguardsDescription')}</p>
          </div>
          {!safeguards || !disclosure ? (
            <LoadingBlock variant="inline" label={t('ai.communication.loadingConfig')} />
          ) : (
            <div className="space-y-5">
              <SettingRow
                first
                icon={Gauge}
                htmlFor="ai-certainty-threshold"
                label={t('ai.communication.certaintyLabel')}
                hint={t('ai.communication.certaintyHint')}
              >
                <Select
                  value={String(safeguards.certaintyThreshold)}
                  onValueChange={(v) => {
                    setSafeguards((prev) => (prev ? { ...prev, certaintyThreshold: Number(v) } : prev))
                  }}
                >
                  <SelectTrigger id="ai-certainty-threshold" className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} -{' '}
                        {n <= 3
                          ? t('ai.communication.certaintyLow')
                          : n <= 7
                            ? t('ai.communication.certaintyMedium')
                            : t('ai.communication.certaintyHigh')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
              <SettingRow
                icon={UserRoundCheck}
                htmlFor="ai-new-contacts"
                label={t('ai.communication.newContactsLabel')}
                hint={t('ai.communication.newContactsHint')}
              >
                <Switch
                  id="ai-new-contacts"
                  checked={safeguards.newContacts}
                  onCheckedChange={(checked) => {
                    setSafeguards((prev) => (prev ? { ...prev, newContacts: checked } : prev))
                  }}
                />
              </SettingRow>
              <SettingRow
                icon={MessageSquareText}
                htmlFor="ai-disclosure"
                label={t('ai.communication.disclosureLabel')}
                hint={t('ai.communication.disclosureHint')}
              >
                <Switch
                  id="ai-disclosure"
                  checked={disclosure.enabled}
                  onCheckedChange={(checked) => {
                    setDisclosure((prev) => (prev ? { ...prev, enabled: checked } : prev))
                  }}
                />
              </SettingRow>
              {disclosure.enabled ? (
                <div className="space-y-1.5 pl-7">
                  <Label htmlFor="ai-disclosure-text" className="text-xs font-medium text-text-secondary">
                    {t('ai.communication.disclosureTextLabel')}
                  </Label>
                  <Input
                    id="ai-disclosure-text"
                    value={disclosure.text}
                    maxLength={200}
                    placeholder={overview?.disclosurePreview ?? t('ai.communication.disclosurePlaceholder')}
                    onChange={(e) => {
                      const text = e.target.value
                      setDisclosure((prev) => (prev ? { ...prev, text } : prev))
                    }}
                  />
                  <p className="text-xs text-text-muted">
                    {t('ai.communication.disclosurePreview', {
                      text: disclosure.text.trim() || overview?.disclosurePreview || '',
                    })}
                  </p>
                </div>
              ) : null}

              <div className="space-y-3 border-t border-border/60 pt-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-medium text-text-heading">{t('ai.communication.breakerTitle')}</h4>
                    <p className="mt-0.5 text-xs text-text-muted">{t('ai.communication.breakerHint')}</p>
                  </div>
                  {breaker ? (
                    <Switch
                      checked={breaker.enabled}
                      onCheckedChange={(checked) =>
                        setBreaker((prev) => (prev ? { ...prev, enabled: checked } : prev))
                      }
                      aria-label={t('ai.communication.breakerTitle')}
                    />
                  ) : null}
                </div>
                {breaker?.enabled ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1 text-xs text-text-secondary">
                      <span>{t('ai.communication.maxAutonomous')}</span>
                      <Input
                        type="number"
                        min={1}
                        max={1000}
                        value={breaker.maxAutonomousPerHour}
                        onChange={(e) =>
                          setBreaker((prev) =>
                            prev ? { ...prev, maxAutonomousPerHour: Number(e.target.value) || 1 } : prev,
                          )
                        }
                      />
                    </label>
                    <label className="space-y-1 text-xs text-text-secondary">
                      <span>{t('ai.communication.maxNegative')}</span>
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        value={breaker.maxNegativePerHour}
                        onChange={(e) =>
                          setBreaker((prev) =>
                            prev ? { ...prev, maxNegativePerHour: Number(e.target.value) || 1 } : prev,
                          )
                        }
                      />
                    </label>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </Card>

        <Card className="space-y-4 p-5" data-testid="ai-handling-reviewed-types">
          <div>
            <h3 className="text-sm font-medium text-text-heading">{t('ai.communication.reviewedTypesTitle')}</h3>
            <p className="mt-0.5 text-xs text-text-muted">{t('ai.communication.reviewedTypesHint')}</p>
          </div>
          {categories.length === 0 ? (
            <p className="text-xs text-text-secondary">{t('ai.communication.noTypes')}</p>
          ) : (
            <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
              {categories.map((row) => {
                const reviewed = row.send_mode !== 'send'
                return (
                  <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <Hashtag name={row.name} category className="min-w-0 text-sm text-text-primary" />
                    <span className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
                      {reviewed ? t('ai.communication.alwaysReview') : t('ai.communication.mayAutoSend')}
                      <Switch
                        checked={reviewed}
                        disabled={busyTypeId === row.id}
                        onCheckedChange={(checked) => void toggleSendMode(row, checked)}
                        aria-label={t('ai.communication.alwaysReview')}
                      />
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </section>

      <section className="space-y-4">
        <Card className="space-y-5 p-5">
          <div>
            <h3 className="text-sm font-medium text-text-heading">{t('ai.communication.languageTitle')}</h3>
            <p className="mt-0.5 text-xs text-text-muted">{t('ai.communication.languageDescription')}</p>
          </div>
          {!aiSettings ? (
            <LoadingBlock variant="inline" label={t('ai.communication.loadingConfig')} />
          ) : (
            <div className="space-y-5">
              <SettingRow
                first
                icon={Languages}
                htmlFor="ai-reply-language"
                label={t('ai.communication.replyLanguageLabel')}
                hint={t('ai.communication.replyLanguageHint')}
              >
                <LanguageSelect
                  id="ai-reply-language"
                  value={aiSettings.replyLanguage}
                  languages={REPLY_LANGUAGES}
                  onChange={(v) => {
                    setAiSettings((prev) => (prev ? { ...prev, replyLanguage: (v || 'auto') as ReplyLanguage } : prev))
                  }}
                />
              </SettingRow>
              <SettingRow
                icon={MessageSquareText}
                htmlFor="ai-workspace-language"
                label={t('ai.communication.workspaceLanguageLabel')}
                hint={t('ai.communication.workspaceLanguageHint')}
              >
                <LanguageSelect
                  id="ai-workspace-language"
                  value={aiSettings.workspaceLanguage}
                  languages={WORKSPACE_LANGUAGES}
                  onChange={(v) => {
                    setAiSettings((prev) =>
                      prev ? { ...prev, workspaceLanguage: (v || 'nl') as WorkspaceLanguage } : prev,
                    )
                  }}
                />
              </SettingRow>
              <SettingRow
                icon={UserRound}
                htmlFor="ai-reply-send-as"
                label={t('ai.communication.sendAsLabel')}
                hint={t('ai.communication.sendAsHint')}
              >
                <Select
                  value={aiSettings.replySendAs}
                  onValueChange={(v) => {
                    setAiSettings((prev) => (prev ? { ...prev, replySendAs: v as ReplySendAs } : prev))
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
              </SettingRow>
            </div>
          )}
        </Card>

        <Card className="space-y-5 p-5">
          <div>
            <h2 className="text-sm font-medium text-text-heading">{t('ai.communication.mailboxExceptionsTitle')}</h2>
            <p className="mt-0.5 text-xs text-text-muted">{t('ai.communication.mailboxExceptionsDescription')}</p>
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
                <MailboxLanguageRow
                  key={mailbox.id}
                  mailbox={mailbox}
                  value={mailboxDrafts[mailbox.id] ?? ''}
                  expanded={expandedMailboxId === mailbox.id}
                  effectiveLanguage={effectiveLanguageLabel(mailboxDrafts[mailbox.id])}
                  onToggle={() => setExpandedMailboxId((prev) => (prev === mailbox.id ? null : mailbox.id))}
                  onChange={(value) => {
                    setMailboxDrafts((prev) => ({ ...prev, [mailbox.id]: value as MailboxReplyLanguage }))
                  }}
                />
              ))}
            </div>
          )}
        </Card>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-medium text-text-heading">{t('ai.communication.whoAnswersTitle')}</h2>
          <p className="mt-0.5 text-xs text-text-muted">{t('ai.communication.whoAnswersDescription')}</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/settings/channels">{t('ai.communication.whoAnswersOpenChannels')}</Link>
        </Button>
      </section>

      <PageRelatedLinks
        links={[
          { to: '/settings/channels', label: t('ai.communication.crossLinks.channels') },
          { to: WEBSITE_WIDGET_CUSTOMIZE_PATH, label: t('ai.communication.crossLinks.widget') },
          { to: '/agents', label: t('ai.communication.crossLinks.agents') },
          { to: GOVERN_POLICY_PATH, label: t('ai.communication.crossLinks.govern') },
          { to: '/docs/inbox/inbox-ai', label: t('pageGuides.learnMore') },
        ]}
      />
    </PageContent>
  )
}

function MailboxLanguageRow({
  mailbox,
  value,
  expanded,
  effectiveLanguage,
  onToggle,
  onChange,
}: {
  mailbox: EmailConnection
  value: MailboxReplyLanguage
  expanded: boolean
  effectiveLanguage: string
  onToggle: () => void
  onChange: (value: string) => void
}) {
  const { t } = useTranslation('nav')
  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-bg-hover/40"
        aria-expanded={expanded}
      >
        <ProviderLogo provider={mailbox.provider} className="h-5 w-5 shrink-0 object-contain" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate-fade text-sm font-medium text-text-heading">
              {mailbox.displayName || mailbox.mailboxEmail}
            </p>
            {value ? (
              <Badge variant="accent" className="rounded-md px-1.5 py-0.5 text-2xs font-medium">
                {t('ai.communication.customBadge')}
              </Badge>
            ) : null}
          </div>
          <p className="truncate-fade text-xs text-text-muted">{mailbox.mailboxEmail}</p>
          <p className="mt-1 text-xs text-text-secondary">{effectiveLanguage}</p>
        </div>
        <ChevronDown
          size={16}
          className={cn('shrink-0 text-text-muted transition-transform', expanded && 'rotate-180')}
        />
      </button>
      {expanded ? (
        <div className="flex items-start justify-between gap-4 border-t border-border/60 bg-bg-elevated/30 px-3 py-4">
          <p className="mt-2 max-w-sm text-xs text-text-muted">{t('ai.communication.mailboxLanguageHint')}</p>
          <LanguageSelect
            id={`ai-language-mailbox-${mailbox.id}`}
            value={value}
            languages={REPLY_LANGUAGES}
            onChange={onChange}
            includeDefault
            defaultLabel={t('ai.communication.useDefault')}
          />
        </div>
      ) : null}
    </div>
  )
}
