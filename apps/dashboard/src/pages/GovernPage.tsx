import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ShieldCheck, Check, X, ChevronDown, ChevronUp, RefreshCw, KeyRound, ExternalLink, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { agentRunsPath, inboxPath } from '../lib/messages-paths'
import { talkToAssistantPath } from '../lib/talk-to-assistant'
import { agentWorkforceRunUrl } from '../lib/workforce-run-urls'
import { PageContent } from '../components/layout/PageContent'
import { PageGuideBanner } from '../components/layout/PageGuideBanner'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { EmptyState } from '../components/ui/empty-state'
import { TableRowsSkeleton } from '../components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import {
  acceptGovernChange,
  getAllowances,
  listAcceptedChanges,
  listAgentPassports,
  listGovernAudit,
  listGovernChanges,
  rejectGovernChange,
  rollbackGovernChange,
  setPosture,
  setToolOverride,
  updateAllowances,
  type AllowanceMode,
  type AuditEventRow,
  type AutonomyPostureId,
  type GovernToolRow,
  type LearningAllowanceNote,
  type PlatformChangeRow,
} from '../lib/govern-api'
import {
  allowanceModeHint,
  allowanceModeLabel,
  governChangeStatusLabel,
  toolCategoryHint,
  toolCategoryLabel,
  formatChangeMeta,
  formatGovernTimestamp,
  summarizeDiff,
} from '../lib/govern-labels'
import { agentAutonomyLevelLabel } from '../lib/labels'
import { agentRoleLabel } from '../lib/agent-role-label'
import { formatPermissionScopes } from '../lib/permission-scope-label'
import { cn } from '../lib/utils'
import { formatAppTime } from '../lib/app-locale'
import { governHaystack, matchesGovernText } from '../lib/govern-list'
import { Input } from '../components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'

const ALLOWANCE_OPTIONS: AllowanceMode[] = ['deny', 'ask', 'allow']
const POSTURE_ORDER: AutonomyPostureId[] = ['manual', 'assisted', 'autonomous']

const STATUS_BADGE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending_review: 'secondary',
  draft: 'secondary',
  accepted: 'default',
  applied_yolo: 'default',
  rejected: 'destructive',
}

function DiffPreview({ change }: { change: PlatformChangeRow }) {
  const { t } = useTranslation('govern')
  const lines = summarizeDiff(change.before ?? {}, change.after ?? {}, t)
  return (
    <ul className="mt-2 max-h-48 space-y-1 overflow-auto rounded-lg border border-border/60 bg-bg-muted/40 p-3 text-xs text-text-secondary">
      {lines.map((line) => (
        <li key={line} className="leading-relaxed">
          {line}
        </li>
      ))}
    </ul>
  )
}

const GOVERN_TABS = new Set(['drafts', 'policy', 'history', 'passports', 'audit'])
const GOVERN_LAST_TAB_KEY = 'bokito.govern.lastTab'

function readLastGovernTab(): string {
  try {
    const stored = localStorage.getItem(GOVERN_LAST_TAB_KEY)
    if (stored && GOVERN_TABS.has(stored)) return stored
  } catch {
    /* ignore */
  }
  return ''
}

function writeLastGovernTab(next: string) {
  try {
    localStorage.setItem(GOVERN_LAST_TAB_KEY, next)
  } catch {
    /* ignore */
  }
}

const HISTORY_PREVIEW = 20
const AUDIT_PREVIEW = 30

export default function GovernPage() {
  const { t, i18n } = useTranslation('govern')
  const { t: tNav } = useTranslation('nav')
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab') ?? ''
  const query = searchParams.get('q') ?? ''
  const [fallbackTab, setFallbackTab] = useState(() => readLastGovernTab() || 'policy')
  const tab = GOVERN_TABS.has(tabParam) ? tabParam : fallbackTab
  useEffect(() => {
    if (GOVERN_TABS.has(tabParam)) writeLastGovernTab(tabParam)
  }, [tabParam])
  const setTab = (next: string) => {
    writeLastGovernTab(next)
    setFallbackTab(next)
    const params = new URLSearchParams(searchParams)
    if (next === 'policy' && !tabParam) {
      params.delete('tab')
    } else {
      params.set('tab', next)
    }
    setSearchParams(params, { replace: true })
  }
  const setQuery = (next: string) => {
    const params = new URLSearchParams(searchParams)
    if (next.trim()) params.set('q', next)
    else params.delete('q')
    setSearchParams(params, { replace: true })
  }
  const [changes, setChanges] = useState<PlatformChangeRow[]>([])
  const [history, setHistory] = useState<PlatformChangeRow[]>([])
  const [audit, setAudit] = useState<AuditEventRow[]>([])
  const [openAuditId, setOpenAuditId] = useState<string | null>(null)
  const [passports, setPassports] = useState<Array<Record<string, unknown>>>([])
  const [allowances, setAllowances] = useState<Record<string, AllowanceMode>>({})
  const [categories, setCategories] = useState<string[]>([])
  const [tools, setTools] = useState<GovernToolRow[]>([])
  const [learningHistory, setLearningHistory] = useState<LearningAllowanceNote[]>([])
  const [posture, setPostureState] = useState<AutonomyPostureId>('assisted')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [savingModes, setSavingModes] = useState(false)
  const [savingPosture, setSavingPosture] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<
    { type: 'accept' | 'reject' | 'rollback'; change: PlatformChangeRow } | null
  >(null)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)
  const [showAllHistory, setShowAllHistory] = useState(false)
  const [showAllAudit, setShowAllAudit] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      listGovernChanges(),
      listAcceptedChanges(),
      listGovernAudit(),
      listAgentPassports(),
      getAllowances(),
    ])
      .then(([changeResp, historyResp, auditResp, passportResp, allowanceResp]) => {
        setChanges(changeResp.items)
        if (!tabParam && !readLastGovernTab() && changeResp.items.length > 0) {
          writeLastGovernTab('drafts')
          setFallbackTab('drafts')
        }
        setHistory(historyResp.items)
        setAudit(auditResp.items)
        setPassports(passportResp.items)
        setAllowances(allowanceResp.allowances)
        setCategories(allowanceResp.categories)
        setTools(allowanceResp.tools)
        setLearningHistory(allowanceResp.learning_history ?? [])
        setPostureState(allowanceResp.posture)
        setRefreshedAt(new Date())
      })
      .catch((err) => setError(formatApiErrorMessage(err, t('loadError'))))
      .finally(() => setLoading(false))
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  async function handleAccept(change: PlatformChangeRow) {
    setBusyId(change.id)
    try {
      await acceptGovernChange(change.id)
      toast.success(t('drafts.accepted'))
      load()
    } catch (err) {
      setError(formatApiErrorMessage(err, t('drafts.acceptFailed')))
    } finally {
      setBusyId(null)
      setPendingConfirm(null)
    }
  }

  async function handleReject(id: string) {
    setBusyId(id)
    try {
      await rejectGovernChange(id)
      toast.success(t('drafts.rejected'))
      load()
    } catch (err) {
      setError(formatApiErrorMessage(err, t('drafts.rejectFailed')))
    } finally {
      setBusyId(null)
      setPendingConfirm(null)
    }
  }

  function requestAccept(change: PlatformChangeRow) {
    setPendingConfirm({ type: 'accept', change })
  }

  function requestReject(change: PlatformChangeRow) {
    setPendingConfirm({ type: 'reject', change })
  }

  function requestRollback(change: PlatformChangeRow) {
    setPendingConfirm({ type: 'rollback', change })
  }

  function confirmPendingAction() {
    if (!pendingConfirm) return
    if (pendingConfirm.type === 'accept') {
      void handleAccept(pendingConfirm.change)
    } else if (pendingConfirm.type === 'reject') {
      void handleReject(pendingConfirm.change.id)
    } else {
      setBusyId(pendingConfirm.change.id)
      void rollbackGovernChange(pendingConfirm.change.id)
        .then(() => {
          toast.success(t('history.rolledBack'))
          load()
        })
        .catch((err) => {
          toast.error(formatApiErrorMessage(err, t('history.rollbackError')))
        })
        .finally(() => {
          setBusyId(null)
          setPendingConfirm(null)
        })
    }
  }

  async function handlePostureChange(next: AutonomyPostureId) {
    if (next === posture || savingPosture) return
    if (next === 'autonomous' && !window.confirm(t('posture.autonomousConfirm'))) return
    setSavingPosture(true)
    try {
      const resp = await setPosture(next)
      setPostureState(resp.posture)
      setAllowances(resp.allowances)
      toast.success(t('posture.saved'))
    } catch (err) {
      setError(formatApiErrorMessage(err, t('postureError')))
      load()
    } finally {
      setSavingPosture(false)
    }
  }

  async function handleAllowanceChange(category: string, mode: AllowanceMode) {
    const next = { ...allowances, [category]: mode }
    setAllowances(next)
    setSavingModes(true)
    try {
      await updateAllowances({ [category]: mode })
      toast.success(t('allowances.saved'))
    } catch (err) {
      setError(formatApiErrorMessage(err, t('allowancesError')))
      load()
    } finally {
      setSavingModes(false)
    }
  }

  async function handleToolOverride(toolName: string, mode: AllowanceMode | null) {
    setTools((prev) =>
      prev.map((tool) => (tool.name === toolName ? { ...tool, override: mode } : tool)),
    )
    setSavingModes(true)
    try {
      await setToolOverride(toolName, mode)
      toast.success(
        mode
          ? t('allowances.toolOverrideSaved', { toolName, mode })
          : t('allowances.toolOverrideCleared', { toolName }),
      )
    } catch (err) {
      setError(formatApiErrorMessage(err, t('toolOverrideError')))
      load()
    } finally {
      setSavingModes(false)
    }
  }

  const filteredChanges = useMemo(
    () =>
      changes.filter((change) =>
        matchesGovernText(
          governHaystack([change.summary, change.resource_type, change.change_kind, change.status, change.id]),
          query,
        ),
      ),
    [changes, query],
  )
  const filteredHistory = useMemo(
    () =>
      history.filter((row) =>
        matchesGovernText(
          governHaystack([row.summary, row.resource_type, row.change_kind, row.status, row.id]),
          query,
        ),
      ),
    [history, query],
  )
  const visibleHistory = showAllHistory ? filteredHistory : filteredHistory.slice(0, HISTORY_PREVIEW)
  const filteredPassports = useMemo(
    () =>
      passports.filter((row) =>
        matchesGovernText(
          governHaystack([
            String(row.name ?? ''),
            String(row.role ?? ''),
            String(row.autonomy_level ?? ''),
            String(row.id ?? ''),
          ]),
          query,
        ),
      ),
    [passports, query],
  )
  const filteredAudit = useMemo(
    () =>
      audit.filter((event) =>
        matchesGovernText(
          governHaystack([event.summary, event.action, event.actor_type, event.outcome, event.resource_type, event.id]),
          query,
        ),
      ),
    [audit, query],
  )
  const visibleAudit = showAllAudit ? filteredAudit : filteredAudit.slice(0, AUDIT_PREVIEW)

  function copyChangeId(id: string) {
    void navigator.clipboard.writeText(id).then(
      () => toast.success(t('drafts.idCopied')),
      () => toast.error(t('audit.copyFailed')),
    )
  }

  const searchField =
    tab !== 'policy' ? (
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('searchPlaceholder')}
        className="h-8 max-w-xs text-xs"
        aria-label={t('searchPlaceholder')}
      />
    ) : null

  return (
    <PageContent width="xl" className="space-y-6">
      <PageGuideBanner page="govern" />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-heading flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" aria-hidden />
            {t('title')}
          </h1>
          <p className="text-sm text-text-muted mt-1">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {refreshedAt ? (
            <span className="text-[11px] text-text-muted">
              {t('refreshedAt', { time: formatAppTime(refreshedAt, i18n.language) })}
            </span>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4 mr-1.5', loading && 'animate-spin')} aria-hidden />
            {t('refresh')}
          </Button>
        </div>
      </header>

      {error ? <ApiErrorBanner message={error} onRetry={load} /> : null}

      {loading ? (
        <TableRowsSkeleton rows={8} />
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex h-auto flex-wrap gap-1">
            <TabsTrigger value="drafts">
              {t('tabs.drafts')}
              {changes.length > 0 ? (
                <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">
                  {changes.length}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="policy">{t('tabs.policy')}</TabsTrigger>
            <TabsTrigger value="history">{t('tabs.history')}</TabsTrigger>
            <TabsTrigger value="passports">{t('tabs.passports')}</TabsTrigger>
            <TabsTrigger value="audit">{t('tabs.audit')}</TabsTrigger>
          </TabsList>

          <TabsContent value="drafts" className="mt-4">
            <Card>
              <CardContent className="space-y-3 pt-6">
                {changes.length > 0 ? searchField : null}
                {changes.length === 0 ? (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted">{t('drafts.empty')}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" asChild>
                        <Link to={inboxPath('open')}>{t('drafts.openCommunication')}</Link>
                      </Button>
                      <Button size="sm" variant="outline" asChild>
                        <Link to="/agents">{t('drafts.openAgents')}</Link>
                      </Button>
                      <Button size="sm" variant="outline" asChild>
                        <Link to="/settings/communication">{t('drafts.openInboxAi')}</Link>
                      </Button>
                    </div>
                  </div>
                ) : (
                  filteredChanges.length === 0 ? (
                    <p className="text-sm text-text-muted">{t('filterEmpty')}</p>
                  ) : (
                  filteredChanges.map((change) => (
                    <div key={change.id} className="rounded-lg border border-border p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-text-heading">{change.summary}</p>
                            <Badge variant={STATUS_BADGE[change.status] ?? 'outline'} className="text-[10px]">
                              {governChangeStatusLabel(change.status, t)}
                            </Badge>
                          </div>
                          <p className="text-xs text-text-muted mt-1">
                            {formatChangeMeta(change.resource_type, change.change_kind, change.status, t)}
                          </p>
                          <button
                            type="button"
                            className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                            onClick={() => setExpandedId(expandedId === change.id ? null : change.id)}
                          >
                            {expandedId === change.id ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                            {t('drafts.viewDiff')}
                          </button>
                          {expandedId === change.id ? <DiffPreview change={change} /> : null}
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          {change.signal_id ? (
                            <Button size="sm" variant="ghost" asChild>
                              <Link to={inboxPath('open', change.signal_id)}>
                                <ExternalLink className="h-4 w-4 mr-1" aria-hidden />
                                {t('drafts.openInCommunication')}
                              </Link>
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => copyChangeId(change.id)}
                          >
                            <Copy className="h-4 w-4 mr-1" aria-hidden />
                            {t('drafts.copyId')}
                          </Button>
                          <Button
                            size="sm"
                            disabled={busyId === change.id}
                            onClick={() => requestAccept(change)}
                          >
                            <Check className="h-4 w-4 mr-1" aria-hidden />
                            {t('drafts.accept')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === change.id}
                            onClick={() => requestReject(change)}
                          >
                            <X className="h-4 w-4 mr-1" aria-hidden />
                            {t('drafts.reject')}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                  )
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="policy" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('posture.title')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-text-muted">{t('posture.intro')}</p>
                <p className="text-xs text-text-muted">{t('posture.perAgentHint')}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <Link to="/agents" className="text-xs font-medium text-accent hover:underline">
                    {t('drafts.openAgents')}
                  </Link>
                  <Link to="/settings/communication" className="text-xs font-medium text-accent hover:underline">
                    {t('drafts.openInboxAi')}
                  </Link>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {POSTURE_ORDER.map((id) => {
                    const active = posture === id
                    return (
                      <button
                        key={id}
                        type="button"
                        disabled={savingPosture}
                        onClick={() => void handlePostureChange(id)}
                        className={cn(
                          'rounded-lg border p-4 text-left transition-colors',
                          active
                            ? 'border-accent bg-accent/5 ring-1 ring-accent/30'
                            : 'border-border/60 hover:border-border hover:bg-bg-muted/40',
                        )}
                      >
                        <p className="text-sm font-medium text-text-heading">
                          {t(`posture.${id}.label`)}
                        </p>
                        <p className="mt-1 text-xs text-text-muted leading-relaxed">
                          {t(`posture.${id}.summary`)}
                        </p>
                        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-text-muted">
                          <li>{t(`posture.${id}.effects.inbox`)}</li>
                          <li>{t(`posture.${id}.effects.tools`)}</li>
                          <li>{t(`posture.${id}.effects.structure`)}</li>
                        </ul>
                        {active ? (
                          <Badge variant="default" className="mt-2 text-[10px]">
                            {t('posture.current')}
                          </Badge>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('allowances.title')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-text-muted">
                  {t('allowances.intro')}
                </p>
                {learningHistory.length > 0 ? (
                  <div className="rounded-lg border border-border/60 bg-bg-muted/40 px-3 py-2 space-y-1.5">
                    <p className="text-[11px] text-text-muted">{t('allowances.learningIntro')}</p>
                    {learningHistory.slice(0, 3).map((note, index) => (
                      <p
                        key={`${note.category ?? 'cat'}-${note.at ?? index}`}
                        className="text-xs text-text-secondary"
                        title={note.reason}
                      >
                        {t('allowances.learningNote', {
                          category: toolCategoryLabel(String(note.category || ''), t),
                          from: allowanceModeLabel((note.from as AllowanceMode) || 'allow', t),
                          to: allowanceModeLabel((note.to as AllowanceMode) || 'ask', t),
                        })}
                      </p>
                    ))}
                  </div>
                ) : null}
                {categories.map((category) => {
                  const current = allowances[category] ?? 'ask'
                  const categoryTools = tools.filter((tool) => tool.category === category && tool.gated)
                  return (
                    <div key={category} className="rounded-lg border border-border/60 p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <span className="text-sm font-medium text-text-heading">
                            {toolCategoryLabel(category, t)}
                          </span>
                          <p className="text-xs text-text-muted mt-0.5">
                            {toolCategoryHint(category, t)}
                          </p>
                        </div>
                        <div
                          className="inline-flex shrink-0 rounded-lg border border-border/60 p-0.5"
                          role="radiogroup"
                          aria-label={t('toolOverride.categoryAria', {
                            category: toolCategoryLabel(category, t),
                          })}
                        >
                          {ALLOWANCE_OPTIONS.map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              role="radio"
                              aria-checked={current === mode}
                              disabled={savingModes}
                              onClick={() => void handleAllowanceChange(category, mode)}
                              className={cn(
                                'rounded-md px-3 py-1 text-xs transition-colors',
                                current === mode
                                  ? mode === 'deny'
                                    ? 'bg-destructive/10 text-destructive font-medium'
                                    : mode === 'allow'
                                      ? 'bg-accent/10 text-accent font-medium'
                                      : 'bg-bg-muted text-text-heading font-medium'
                                  : 'text-text-muted hover:text-text-heading',
                              )}
                            >
                              {allowanceModeLabel(mode, t)}
                            </button>
                          ))}
                        </div>
                      </div>
                      <p className="mt-1.5 text-[11px] text-text-muted">
                        {allowanceModeHint(current, t)}
                      </p>
                      {categoryTools.length > 0 ? (
                        <div className="mt-2 space-y-1 border-t border-border/40 pt-2">
                          {categoryTools.map((tool) => {
                            const effective = tool.override ?? current
                            return (
                              <div
                                key={tool.name}
                                className="flex items-center justify-between gap-2"
                              >
                                <span
                                  className="truncate font-mono text-[11px] text-text-secondary"
                                  title={tool.description}
                                >
                                  {tool.name}
                                  {tool.override ? (
                                    <span className="ml-1.5 text-[10px] text-accent">
                                      {t('toolOverride.override')}
                                    </span>
                                  ) : null}
                                </span>
                                <div className="inline-flex shrink-0 rounded-md border border-border/60 p-0.5">
                                  {(['inherit', 'deny', 'ask', 'allow'] as const).map((mode) => {
                                    const isInherit = mode === 'inherit'
                                    const selected = isInherit ? !tool.override : tool.override === mode
                                    return (
                                      <button
                                        key={mode}
                                        type="button"
                                        disabled={savingModes}
                                        onClick={() =>
                                          void handleToolOverride(
                                            tool.name,
                                            isInherit ? null : (mode as AllowanceMode),
                                          )
                                        }
                                        className={cn(
                                          'rounded px-2 py-0.5 text-[10px] transition-colors',
                                          selected
                                            ? mode === 'deny'
                                              ? 'bg-destructive/10 font-medium text-destructive'
                                              : mode === 'allow'
                                                ? 'bg-accent/10 font-medium text-accent'
                                                : 'bg-bg-muted font-medium text-text-heading'
                                            : 'text-text-muted hover:text-text-heading',
                                        )}
                                        title={
                                          isInherit
                                            ? t('toolOverride.useCategoryDefault', {
                                                mode: allowanceModeLabel(current, t),
                                              })
                                            : t('toolOverride.effectiveNow', {
                                                mode: allowanceModeLabel(effective, t),
                                              })
                                        }
                                      >
                                        {isInherit
                                          ? t('toolOverride.default')
                                          : allowanceModeLabel(mode, t)}
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4" aria-hidden />
                  {t('tokens.title')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-text-muted">
                  {t('tokens.movedIntro')}
                </p>
                <Button size="sm" variant="outline" className="mt-3" asChild>
                  <Link to="/settings/developers">
                    {t('tokens.manageLink')}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <Card>
              <CardContent className="space-y-2 pt-6">
                {history.length > 0 ? searchField : null}
                {history.length === 0 ? (
                  <EmptyState
                    size="sm"
                    icon={ShieldCheck}
                    title={t('history.empty')}
                    action={
                      <div className="flex flex-wrap justify-center gap-2">
                        <Button size="sm" asChild>
                          <Link to={talkToAssistantPath(t('history.talkPrefill'))}>{t('history.talkAssistant')}</Link>
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <Link to="/settings/govern?tab=drafts">{t('history.openDrafts')}</Link>
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <Link to={inboxPath('open')}>{t('drafts.openCommunication')}</Link>
                        </Button>
                      </div>
                    }
                    className="border-0 shadow-none"
                  />
                ) : (
                  filteredHistory.length === 0 ? (
                    <p className="text-sm text-text-muted">{t('filterEmpty')}</p>
                  ) : (
                    <>
                      {visibleHistory.map((row) => (
                    <div
                      key={row.id}
                      className="flex items-start justify-between gap-3 text-sm border-b border-border pb-2 last:border-0"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-text-heading">{row.summary}</p>
                        <p className="text-xs text-text-muted mt-0.5">
                          {formatChangeMeta(row.resource_type, row.change_kind, row.status, t)} · v{row.version} ·{' '}
                          {formatGovernTimestamp(row.resolved_at ?? row.created_at, i18n.language)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button type="button" size="sm" variant="ghost" onClick={() => copyChangeId(row.id)}>
                          <Copy className="h-4 w-4 mr-1" aria-hidden />
                          {t('drafts.copyId')}
                        </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busyId === row.id}
                        onClick={() => requestRollback(row)}
                      >
                        {t('history.rollback')}
                      </Button>
                      </div>
                    </div>
                      ))}
                      {filteredHistory.length > HISTORY_PREVIEW ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setShowAllHistory((open) => !open)}
                        >
                          {showAllHistory
                            ? t('showFewer')
                            : t('showAll', { count: filteredHistory.length })}
                        </Button>
                      ) : null}
                    </>
                  )
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="passports" className="mt-4">
            <Card>
              <CardContent className="space-y-2 pt-6">
                <p className="text-xs text-text-muted">{t('passports.hint')}</p>
                {passports.length > 0 ? searchField : null}
                {passports.length === 0 ? (
                  <EmptyState
                    size="sm"
                    icon={ShieldCheck}
                    title={t('passports.empty')}
                    action={
                      <div className="flex flex-wrap justify-center gap-2">
                        <Button type="button" size="sm" variant="secondary" asChild>
                          <Link to="/agents">{t('passports.openAgents')}</Link>
                        </Button>
                        <Button type="button" size="sm" variant="outline" asChild>
                          <Link to="/settings/communication">{t('drafts.openInboxAi')}</Link>
                        </Button>
                      </div>
                    }
                    className="border-0 shadow-none"
                  />
                ) : (
                  filteredPassports.length === 0 ? (
                    <p className="text-sm text-text-muted">{t('filterEmpty')}</p>
                  ) : (
                  filteredPassports.map((row) => (
                    <div key={String(row.id)} className="rounded-lg border border-border p-3">
                      <p className="text-sm font-medium text-text-heading">
                        {String(row.name)}{' '}
                        <span className="text-text-muted font-normal">({agentRoleLabel(String(row.role), tNav)})</span>
                      </p>
                      <p className="text-xs text-text-muted mt-1">
                        {t('passports.autonomy', {
                          level: agentAutonomyLevelLabel(
                            row.autonomy_level ? String(row.autonomy_level) : null,
                            tNav,
                          ),
                        })}
                      </p>
                      <p className="text-xs text-text-muted mt-1 break-words">
                        {t('passports.scopes', {
                          scopes: formatPermissionScopes(
                            Array.isArray(row.permission_scopes) ? (row.permission_scopes as string[]) : [],
                            tNav,
                            t('passports.roleDefaults'),
                          ),
                        })}
                      </p>
                      <Link
                        to={`/agents/${String(row.id)}`}
                        className="mt-2 inline-block text-xs font-medium text-accent hover:underline"
                      >
                        {t('passports.openAgent')}
                      </Link>
                    </div>
                  ))
                  )
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit" className="mt-4">
            <Card>
              <CardContent className="space-y-2 pt-6">
                {audit.length > 0 ? searchField : null}
                {audit.length === 0 ? (
                  <EmptyState
                    size="sm"
                    icon={ShieldCheck}
                    title={t('audit.empty')}
                    action={
                      <div className="flex flex-wrap justify-center gap-2">
                        <Button size="sm" asChild>
                          <Link to={talkToAssistantPath(t('audit.talkPrefill'))}>{t('audit.talkAssistant')}</Link>
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <Link to={inboxPath('open')}>{t('audit.openCommunication')}</Link>
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <Link to="/agents">{t('audit.openAgent')}</Link>
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <Link to="/settings/govern?tab=drafts">{t('history.openDrafts')}</Link>
                        </Button>
                      </div>
                    }
                    className="border-0 shadow-none"
                  />
                ) : (
                  filteredAudit.length === 0 ? (
                    <p className="text-sm text-text-muted">{t('filterEmpty')}</p>
                  ) : (
                    <>
                  {visibleAudit.map((event) => {
                    // Deep-link the audited resource where a surface exists.
                    const target =
                      event.resource_type === 'signal' && event.resource_id
                        ? inboxPath('open', event.resource_id)
                        : event.agent_id && event.run_id
                          ? agentWorkforceRunUrl(event.agent_id, event.run_id)
                          : event.resource_type === 'agent' && event.resource_id
                            ? `/agents/${event.resource_id}`
                            : event.agent_id
                              ? `/agents/${event.agent_id}`
                              : null
                    return (
                      <div key={event.id} className="text-sm border-b border-border pb-2 last:border-0">
                        <p className="font-medium text-text-heading">{event.summary || event.action}</p>
                        <p className="text-xs text-text-muted mt-0.5">
                          {event.actor_type} · {event.outcome}
                          {event.created_at ? ` · ${formatGovernTimestamp(event.created_at, i18n.language)}` : null}
                          {target ? (
                            <>
                              {' · '}
                              <Link to={target} className="text-accent hover:underline">
                                {event.resource_type === 'signal'
                                  ? t('audit.openThread')
                                  : event.run_id
                                    ? t('audit.openRun')
                                    : t('audit.openAgent')}
                              </Link>
                            </>
                          ) : null}
                          {' · '}
                          <button
                            type="button"
                            onClick={() => setOpenAuditId((id) => (id === event.id ? null : event.id))}
                            className="text-accent hover:underline"
                          >
                            {openAuditId === event.id ? t('audit.hidePayload') : t('audit.showPayload')}
                          </button>
                        </p>
                        {openAuditId === event.id ? (
                          <div className="mt-1.5">
                            <pre className="max-h-40 overflow-auto rounded-md bg-bg-elevated/70 px-2 py-1.5 text-[11px] text-text-secondary">
                              {JSON.stringify(event, null, 2)}
                            </pre>
                            <button
                              type="button"
                              onClick={() => {
                                void navigator.clipboard.writeText(JSON.stringify(event, null, 2)).then(
                                  () => toast.success(t('audit.copied')),
                                  () => toast.error(t('audit.copyFailed')),
                                )
                              }}
                              className="mt-1 text-[11px] font-medium text-accent hover:underline"
                            >
                              {t('audit.copyPayload')}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                      {filteredAudit.length > AUDIT_PREVIEW ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setShowAllAudit((open) => !open)}
                        >
                          {showAllAudit
                            ? t('showFewer')
                            : t('showAll', { count: filteredAudit.length })}
                        </Button>
                      ) : null}
                    </>
                  )
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={pendingConfirm !== null} onOpenChange={(open) => !open && setPendingConfirm(null)}>
        <DialogContent
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.altKey) return
            const target = event.target as HTMLElement | null
            if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON')) return
            event.preventDefault()
            confirmPendingAction()
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {pendingConfirm?.type === 'accept'
                ? t('drafts.acceptTitle')
                : pendingConfirm?.type === 'rollback'
                  ? t('history.rollbackTitle')
                  : t('drafts.rejectTitle')}
            </DialogTitle>
            <DialogDescription>
              {pendingConfirm?.change.summary ? (
                <span className="mb-2 block font-medium text-text-heading">{pendingConfirm.change.summary}</span>
              ) : null}
              {pendingConfirm?.type === 'accept'
                ? t('drafts.acceptConfirm')
                : pendingConfirm?.type === 'rollback'
                  ? t('history.rollbackConfirm')
                  : t('drafts.rejectConfirm')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setPendingConfirm(null)} disabled={busyId !== null}>
              {t('history.cancel')}
            </Button>
            <Button
              type="button"
              variant={pendingConfirm?.type === 'reject' ? 'destructive' : 'default'}
              disabled={busyId !== null}
              onClick={confirmPendingAction}
            >
              {pendingConfirm?.type === 'accept'
                ? t('drafts.acceptAction')
                : pendingConfirm?.type === 'rollback'
                  ? t('history.rollback')
                  : t('drafts.rejectAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContent>
  )
}
