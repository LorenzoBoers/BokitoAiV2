import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AutosaveStatus } from '../../ui/AutosaveStatus'
import { useConfirm } from '../../ui/confirm-dialog'
import { useAuth } from '../../../context/AuthContext'
import { useAutosave } from '../../../hooks/useAutosave'
import { useIsAdmin } from '../../../hooks/useIsAdmin'
import { useMailboxConnections } from '../../../hooks/useMailboxConnections'
import type { AiHandlingMode } from '../../../lib/ai-handling'
import {
  getAiHandlingOverview,
  resetAiBreaker,
  saveAiHandlingSettings,
  setAiHandling,
  type AiHandlingBreaker,
  type AiHandlingDisclosure,
  type AiHandlingException,
  type AiHandlingOverview,
  type AiHandlingRouting,
  type AiHandlingSafeguards,
} from '../../../lib/ai-handling-api'
import { getAiConfig, saveAiConfig, type MailboxReplyLanguage } from '../../../lib/email-api'
import {
  getAiCommunicationSettings,
  saveAiCommunicationSettings,
  type AiCommunicationSettings,
} from '../../../lib/inbox-api'
import { listAgents } from '../../../lib/agents-api'
import { setLeadAgent } from '../../../lib/workforce-api'
import { resetTenantDefaultSendAs } from '../../../lib/reply-send-as'
import { AutonomyDial } from './AutonomyDial'
import { AutoReviewCard } from './AutoReviewCard'
import { ChannelExceptionsCard } from './ChannelExceptionsCard'
import { HandoverCard, type LeadAgentOption } from './HandoverCard'
import { LanguageCard } from './LanguageCard'
import { SafeguardsCard } from './SafeguardsCard'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Govern > Policy: the Autonomy dial, then per channel, safeguards, handovers
 * and language. ``after`` renders below (the collapsed tool defaults).
 */
export function AutonomySettings({ after }: { after?: ReactNode }) {
  const { t } = useTranslation('nav')
  const { t: tc } = useTranslation('common')
  const { token } = useAuth()
  const isAdmin = useIsAdmin()
  const confirm = useConfirm()
  const { activeConnections: mailboxes, loading: mailboxesLoading } = useMailboxConnections()

  const [overview, setOverview] = useState<AiHandlingOverview | null>(null)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [dialSaving, setDialSaving] = useState(false)
  const [safeguards, setSafeguards] = useState<AiHandlingSafeguards | null>(null)
  const [breaker, setBreaker] = useState<AiHandlingBreaker | null>(null)
  const [disclosure, setDisclosure] = useState<AiHandlingDisclosure | null>(null)
  const [routing, setRouting] = useState<AiHandlingRouting | null>(null)
  const [agents, setAgents] = useState<LeadAgentOption[]>([])
  const [leadBusy, setLeadBusy] = useState(false)
  const [settings, setSettings] = useState<AiCommunicationSettings | null>(null)
  const [savedSettings, setSavedSettings] = useState<AiCommunicationSettings | null>(null)
  const [mailboxDrafts, setMailboxDrafts] = useState<Record<number, MailboxReplyLanguage>>({})
  const [savedMailboxDrafts, setSavedMailboxDrafts] = useState<Record<number, MailboxReplyLanguage>>({})
  const [loadingMailboxConfigs, setLoadingMailboxConfigs] = useState(false)
  const [mailboxError, setMailboxError] = useState<string | null>(null)
  const [expandedMailboxId, setExpandedMailboxId] = useState<number | null>(null)

  const applyOverview = useCallback((next: AiHandlingOverview) => {
    setOverview(next)
    setSafeguards(next.safeguards)
    setBreaker(next.breaker)
    setDisclosure(next.disclosure)
    setRouting(next.routing)
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

  useEffect(() => {
    void loadOverview()
    void listAgents()
      .then((rows) =>
        setAgents(
          rows
            .filter((agent) => agent.kind === 'company' && agent.is_active !== false)
            .map((agent) => ({ id: agent.id, name: agent.name, isLead: Boolean(agent.is_lead) })),
        ),
      )
      .catch(() => setAgents([]))
  }, [loadOverview])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void getAiCommunicationSettings(token)
      .then((data) => {
        if (cancelled) return
        setSettings(data)
        setSavedSettings(data)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [token])

  const mailboxIdsKey = useMemo(() => mailboxes.map((mailbox) => mailbox.id).join(','), [mailboxes])

  useEffect(() => {
    if (!token || mailboxesLoading) return
    if (!mailboxIdsKey) {
      setMailboxDrafts({})
      setSavedMailboxDrafts({})
      setExpandedMailboxId(null)
      setMailboxError(null)
      setLoadingMailboxConfigs(false)
      return
    }
    const ids = mailboxIdsKey.split(',').map(Number)
    let cancelled = false
    setLoadingMailboxConfigs(true)
    setMailboxError(null)
    void Promise.all(ids.map(async (id) => [id, (await getAiConfig(token, id)).replyLanguage] as const))
      .then((rows) => {
        if (cancelled) return
        const next: Record<number, MailboxReplyLanguage> = {}
        for (const [id, language] of rows) next[id] = language
        setMailboxDrafts(next)
        setSavedMailboxDrafts(next)
        setExpandedMailboxId((prev) => (prev != null && ids.includes(prev) ? prev : null))
      })
      .catch((err) => {
        if (!cancelled) setMailboxError(err instanceof Error ? err.message : t('ai.communication.loadError'))
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
      mailboxes
        .filter((mailbox) => (mailboxDrafts[mailbox.id] ?? '') !== (savedMailboxDrafts[mailbox.id] ?? ''))
        .map((mailbox) => mailbox.id),
    [mailboxes, mailboxDrafts, savedMailboxDrafts],
  )
  const settingsDirty = settings != null && savedSettings != null && !same(settings, savedSettings)
  const safeguardsDirty = overview != null && safeguards != null && !same(safeguards, overview.safeguards)
  const breakerDirty = overview != null && breaker != null && !same(breaker, overview.breaker)
  const disclosureDirty = overview != null && disclosure != null && !same(disclosure, overview.disclosure)
  const routingDirty = overview != null && routing != null && !same(routing, overview.routing)
  const mailboxDirty = dirtyMailboxIds.length > 0
  const isDirty = settingsDirty || safeguardsDirty || breakerDirty || disclosureDirty || routingDirty || mailboxDirty

  const handleSave = useCallback(async () => {
    if (!token) return
    try {
      if (safeguardsDirty || breakerDirty || disclosureDirty || routingDirty) {
        applyOverview(
          await saveAiHandlingSettings(token, {
            ...(safeguardsDirty && safeguards ? { safeguards } : {}),
            ...(breakerDirty && breaker ? { breaker } : {}),
            ...(disclosureDirty && disclosure ? { disclosure } : {}),
            ...(routingDirty && routing ? { routing } : {}),
          }),
        )
      }
      if (settingsDirty && settings) {
        await saveAiCommunicationSettings(token, settings)
        setSavedSettings(settings)
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
    routingDirty,
    safeguards,
    breaker,
    disclosure,
    routing,
    settingsDirty,
    settings,
    mailboxDirty,
    dirtyMailboxIds,
    mailboxDrafts,
    applyOverview,
    t,
  ])

  const { phase, lastSavedAt, error: autosaveError } = useAutosave({
    dirty: isDirty,
    enabled: Boolean(token),
    save: handleSave,
    delayMs: 900,
  })

  const changeDial = async (mode: AiHandlingMode) => {
    if (!token || !overview || mode === overview.ceiling || dialSaving) return
    if (mode === 'autonomous' && !(await confirm({ description: tc('aiHandling.preview.confirm') }))) return
    setDialSaving(true)
    try {
      applyOverview(await saveAiHandlingSettings(token, { ceiling: mode }))
      toast.success(tc('aiHandling.changed', { mode: tc(`aiHandling.modes.${mode}.label`) }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tc('aiHandling.saveError'))
    } finally {
      setDialSaving(false)
    }
  }

  const clearException = async (scope: 'channel' | 'conversation', row: AiHandlingException) => {
    if (!token) return
    try {
      const updated = await setAiHandling(token, scope, row.id, null)
      await loadOverview()
      const source = updated?.inheritedSourceLabel || tc(`aiHandling.sources.${updated?.inheritedSource ?? 'workspace'}`)
      toast.success(tc('aiHandling.cleared', { source }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tc('aiHandling.saveError'))
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

  const changeLead = (agentId: string) => {
    if (!token) return
    setLeadBusy(true)
    void setLeadAgent(token, agentId)
      .then(() => {
        setAgents((rows) => rows.map((agent) => ({ ...agent, isLead: agent.id === agentId })))
        toast.success(t('ai.communication.defaultAgentSaved'))
      })
      .catch(() => toast.error(t('ai.communication.defaultAgentError')))
      .finally(() => setLeadBusy(false))
  }

  return (
    <div className="space-y-4" data-testid="ai-handling-settings">
      <div className="flex justify-end">
        <AutosaveStatus phase={phase} lastSavedAt={lastSavedAt} error={autosaveError} />
      </div>
      <AutonomyDial overview={overview} error={overviewError} saving={dialSaving} onChange={(mode) => void changeDial(mode)} />
      <ChannelExceptionsCard
        overview={overview}
        onClear={(scope, row) => void clearException(scope, row)}
        onResumeBreaker={(id) => void resumeBreaker(id)}
      />
      <SafeguardsCard
        safeguards={safeguards}
        setSafeguards={setSafeguards}
        breaker={breaker}
        setBreaker={setBreaker}
        disclosure={disclosure}
        setDisclosure={setDisclosure}
        routing={routing}
        setRouting={setRouting}
        disclosurePreview={overview?.disclosurePreview ?? null}
      />
      <HandoverCard
        routing={routing}
        setRouting={setRouting}
        agents={agents}
        canEditLead={isAdmin}
        leadBusy={leadBusy}
        onLeadChange={changeLead}
      />
      <LanguageCard
        settings={settings}
        setSettings={setSettings}
        mailboxes={mailboxes}
        mailboxesLoading={mailboxesLoading || loadingMailboxConfigs}
        mailboxError={mailboxError}
        mailboxDrafts={mailboxDrafts}
        setMailboxDrafts={setMailboxDrafts}
        expandedMailboxId={expandedMailboxId}
        setExpandedMailboxId={setExpandedMailboxId}
      />
      <AutoReviewCard canEdit={isAdmin} />
      {after}
    </div>
  )
}
