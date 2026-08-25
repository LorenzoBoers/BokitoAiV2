import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ShieldCheck, Check, X, ChevronDown, ChevronUp, RefreshCw, KeyRound, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { agentRunsPath, inboxPath } from '../lib/messages-paths'
import { agentWorkforceRunUrl } from '../lib/workforce-run-urls'
import { PageContent } from '../components/layout/PageContent'
import { PageGuideBanner } from '../components/layout/PageGuideBanner'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { EmptyState } from '../components/ui/empty-state'
import { LoadingBlock } from '../components/ui/loading-block'
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
import { cn } from '../lib/utils'
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

export default function GovernPage() {
  const { t } = useTranslation('govern')
  const { t: tNav } = useTranslation('nav')
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab') ?? ''
  const tab = GOVERN_TABS.has(tabParam) ? tabParam : 'drafts'
  const setTab = (next: string) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'drafts') params.delete('tab')
    else params.set('tab', next)
    setSearchParams(params, { replace: true })
  }
  const [changes, setChanges] = useState<PlatformChangeRow[]>([])
  const [history, setHistory] = useState<PlatformChangeRow[]>([])
  const [audit, setAudit] = useState<AuditEventRow[]>([])
  const [passports, setPassports] = useState<Array<Record<string, unknown>>>([])
  const [allowances, setAllowances] = useState<Record<string, AllowanceMode>>({})
  const [categories, setCategories] = useState<string[]>([])
  const [tools, setTools] = useState<GovernToolRow[]>([])
  const [posture, setPostureState] = useState<AutonomyPostureId>('assisted')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [savingModes, setSavingModes] = useState(false)
  const [savingPosture, setSavingPosture] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<
    { type: 'accept' | 'reject'; change: PlatformChangeRow } | null
  >(null)

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
        setHistory(historyResp.items)
        setAudit(auditResp.items)
        setPassports(passportResp.items)
        setAllowances(allowanceResp.allowances)
        setCategories(allowanceResp.categories)
        setTools(allowanceResp.tools)
        setPostureState(allowanceResp.posture)
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
      setError(formatApiErrorMessage(err, 'Accept failed.'))
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
      setError(formatApiErrorMessage(err, 'Reject failed.'))
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

  function confirmPendingAction() {
    if (!pendingConfirm) return
    if (pendingConfirm.type === 'accept') {
      void handleAccept(pendingConfirm.change)
    } else {
      void handleReject(pendingConfirm.change.id)
    }
  }

  async function handlePostureChange(next: AutonomyPostureId) {
    if (next === posture || savingPosture) return
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
        <Button type="button" size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4 mr-1.5', loading && 'animate-spin')} aria-hidden />
          {t('refresh')}
        </Button>
      </header>

      {error ? <ApiErrorBanner message={error} onRetry={load} /> : null}

      {loading ? (
        <LoadingBlock label={t('loading')} />
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
                {changes.length === 0 ? (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted">{t('drafts.empty')}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" asChild>
                        <Link to="/communication/inbox/all">{t('drafts.openCommunication')}</Link>
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
                  changes.map((change) => (
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
                              <Link to={agentRunsPath('awaiting-decision', change.signal_id)}>
                                <ExternalLink className="h-4 w-4 mr-1" aria-hidden />
                                {t('drafts.openInCommunication')}
                              </Link>
                            </Button>
                          ) : null}
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
                {history.length === 0 ? (
                  <EmptyState
                    size="sm"
                    icon={ShieldCheck}
                    title={t('history.empty')}
                    action={
                      <div className="flex flex-wrap justify-center gap-2">
                        <Button size="sm" variant="outline" asChild>
                          <Link to="/settings/govern?tab=drafts">{t('history.openDrafts')}</Link>
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <Link to="/communication/inbox/all">{t('drafts.openCommunication')}</Link>
                        </Button>
                      </div>
                    }
                    className="border-0 shadow-none"
                  />
                ) : (
                  history.slice(0, 20).map((row) => (
                    <div
                      key={row.id}
                      className="flex items-start justify-between gap-3 text-sm border-b border-border pb-2 last:border-0"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-text-heading">{row.summary}</p>
                        <p className="text-xs text-text-muted mt-0.5">
                          {formatChangeMeta(row.resource_type, row.change_kind, row.status, t)} · v{row.version} ·{' '}
                          {formatGovernTimestamp(row.resolved_at ?? row.created_at)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busyId === row.id}
                        onClick={() => {
                          setBusyId(row.id)
                          void rollbackGovernChange(row.id)
                            .then(() => {
                              toast.success(t('history.rolledBack'))
                              load()
                            })
                            .catch((err) => {
                              toast.error(formatApiErrorMessage(err, t('history.rollbackError')))
                            })
                            .finally(() => setBusyId(null))
                        }}
                      >
                        {t('history.rollback')}
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="passports" className="mt-4">
            <Card>
              <CardContent className="space-y-2 pt-6">
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
                  passports.map((row) => (
                    <div key={String(row.id)} className="rounded-lg border border-border p-3">
                      <p className="text-sm font-medium text-text-heading">
                        {String(row.name)}{' '}
                        <span className="text-text-muted font-normal">({String(row.role)})</span>
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
                          scopes: Array.isArray(row.permission_scopes)
                            ? (row.permission_scopes as string[]).join(', ') || t('passports.roleDefaults')
                            : t('passports.roleDefaults'),
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
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit" className="mt-4">
            <Card>
              <CardContent className="space-y-2 pt-6">
                {audit.length === 0 ? (
                  <EmptyState
                    size="sm"
                    icon={ShieldCheck}
                    title={t('audit.empty')}
                    action={
                      <div className="flex flex-wrap justify-center gap-2">
                        <Button size="sm" asChild>
                          <Link to={inboxPath('all')}>{t('audit.openCommunication')}</Link>
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
                  audit.slice(0, 30).map((event) => {
                    // Deep-link the audited resource where a surface exists.
                    const target =
                      event.resource_type === 'signal' && event.resource_id
                        ? inboxPath('all', event.resource_id)
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
                          {event.created_at ? ` · ${formatGovernTimestamp(event.created_at)}` : null}
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
                        </p>
                      </div>
                    )
                  })
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={pendingConfirm !== null} onOpenChange={(open) => !open && setPendingConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingConfirm?.type === 'accept' ? t('drafts.acceptTitle') : t('drafts.rejectTitle')}
            </DialogTitle>
            <DialogDescription>
              {pendingConfirm?.type === 'accept'
                ? t('drafts.acceptConfirm')
                : t('drafts.rejectConfirm')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setPendingConfirm(null)} disabled={busyId !== null}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={pendingConfirm?.type === 'reject' ? 'destructive' : 'default'}
              disabled={busyId !== null}
              onClick={confirmPendingAction}
            >
              {pendingConfirm?.type === 'accept' ? t('drafts.acceptAction') : t('drafts.rejectAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContent>
  )
}
