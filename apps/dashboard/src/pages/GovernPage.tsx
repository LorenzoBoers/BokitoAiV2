import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ShieldCheck, Check, X, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { PageContent } from '../components/layout/PageContent'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { LoadingBlock } from '../components/ui/loading-block'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import {
  acceptGovernChange,
  getApplyModes,
  getPosture,
  listAcceptedChanges,
  listAgentPassports,
  listGovernAudit,
  listGovernChanges,
  rejectGovernChange,
  setPosture,
  updateApplyModes,
  type AuditEventRow,
  type AutonomyPostureId,
  type PlatformChangeRow,
  type PosturePreset,
} from '../lib/govern-api'
import {
  APPLY_MODE_LABELS,
  formatChangeMeta,
  formatGovernTimestamp,
  RESOURCE_TYPE_LABELS,
  summarizeDiff,
} from '../lib/govern-labels'
import { cn } from '../lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'

const APPLY_MODE_OPTIONS = ['draft', 'yolo', 'decision'] as const
const RESOURCE_TYPES = ['agent', 'workstream', 'blueprint_block', 'integration', 'mcp_server', 'canvas_node'] as const
const POSTURE_ORDER: AutonomyPostureId[] = ['manual', 'assisted', 'autonomous']

const STATUS_BADGE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending_review: 'secondary',
  draft: 'secondary',
  accepted: 'default',
  applied_yolo: 'default',
  rejected: 'destructive',
}

function DiffPreview({ change }: { change: PlatformChangeRow }) {
  const lines = summarizeDiff(change.before ?? {}, change.after ?? {})
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

export default function GovernPage() {
  const { t } = useTranslation('govern')
  const [tab, setTab] = useState('drafts')
  const [changes, setChanges] = useState<PlatformChangeRow[]>([])
  const [history, setHistory] = useState<PlatformChangeRow[]>([])
  const [audit, setAudit] = useState<AuditEventRow[]>([])
  const [passports, setPassports] = useState<Array<Record<string, unknown>>>([])
  const [applyModes, setApplyModes] = useState<Record<string, string>>({})
  const [posture, setPostureState] = useState<AutonomyPostureId>('assisted')
  const [posturePresets, setPosturePresets] = useState<PosturePreset[]>([])
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
      getApplyModes(),
      getPosture(),
    ])
      .then(([changeResp, historyResp, auditResp, passportResp, modesResp, postureResp]) => {
        setChanges(changeResp.items)
        setHistory(historyResp.items)
        setAudit(auditResp.items)
        setPassports(passportResp.items)
        setApplyModes(modesResp.tenant_modes ?? modesResp.defaults ?? {})
        setPostureState(postureResp.posture)
        setPosturePresets(postureResp.presets)
      })
      .catch((err) => setError(formatApiErrorMessage(err, 'Could not load govern data.')))
      .finally(() => setLoading(false))
  }, [])

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
      setApplyModes(resp.platform_apply_modes)
      setPosturePresets(resp.presets)
      toast.success(t('posture.saved'))
    } catch (err) {
      setError(formatApiErrorMessage(err, 'Could not update autonomy posture.'))
      load()
    } finally {
      setSavingPosture(false)
    }
  }

  async function handleApplyModeChange(resourceType: string, mode: string) {
    const next = { ...applyModes, [resourceType]: mode }
    setApplyModes(next)
    setSavingModes(true)
    try {
      await updateApplyModes(next)
      toast.success(t('applyModes.saved'))
    } catch (err) {
      setError(formatApiErrorMessage(err, 'Could not save apply modes.'))
      load()
    } finally {
      setSavingModes(false)
    }
  }

  return (
    <PageContent width="xl" className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text-heading flex items-center gap-2">
            <ShieldCheck className="h-6 w-6" aria-hidden />
            {t('title')}
          </h1>
          <p className="text-sm text-text-muted mt-1">
            {t('subtitle')}{' '}
            <Link to="/os" className="text-accent hover:underline">
              {t('openCanvas')}
            </Link>
          </p>
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
                  <p className="text-sm text-text-muted">{t('drafts.empty')}</p>
                ) : (
                  changes.map((change) => (
                    <div key={change.id} className="rounded-lg border border-border p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-text-heading">{change.summary}</p>
                            <Badge variant={STATUS_BADGE[change.status] ?? 'outline'} className="text-[10px]">
                              {change.status.replace(/_/g, ' ')}
                            </Badge>
                          </div>
                          <p className="text-xs text-text-muted mt-1">
                            {formatChangeMeta(change.resource_type, change.change_kind, change.status)}
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
                        <div className="flex shrink-0 gap-2">
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
                    const preset = posturePresets.find((p) => p.id === id)
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
                          {preset?.label ?? t(`posture.${id}.label`)}
                        </p>
                        <p className="mt-1 text-xs text-text-muted leading-relaxed">
                          {preset?.summary ?? t(`posture.${id}.summary`)}
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
                <CardTitle>{t('applyModes.title')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-text-muted">{t('applyModes.intro')}</p>
                {RESOURCE_TYPES.map((rt) => (
                  <div
                    key={rt}
                    className="flex flex-col gap-1 rounded-lg border border-border/60 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <span className="text-sm font-medium text-text-heading">
                        {RESOURCE_TYPE_LABELS[rt] ?? rt}
                      </span>
                      <p className="text-xs text-text-muted mt-0.5">
                        {APPLY_MODE_LABELS[applyModes[rt] ?? 'draft']?.hint ?? APPLY_MODE_LABELS.draft.hint}
                      </p>
                    </div>
                    <select
                      className="rounded border border-border bg-bg-surface px-2 py-1.5 text-xs min-w-[10rem]"
                      value={applyModes[rt] ?? 'draft'}
                      disabled={savingModes}
                      onChange={(e) => void handleApplyModeChange(rt, e.target.value)}
                    >
                      {APPLY_MODE_OPTIONS.map((mode) => (
                        <option key={mode} value={mode}>
                          {APPLY_MODE_LABELS[mode]?.label ?? mode}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <Card>
              <CardContent className="space-y-2 pt-6">
                {history.length === 0 ? (
                  <p className="text-sm text-text-muted">{t('history.empty')}</p>
                ) : (
                  history.slice(0, 20).map((row) => (
                    <div key={row.id} className="text-sm border-b border-border pb-2 last:border-0">
                      <p className="font-medium text-text-heading">{row.summary}</p>
                      <p className="text-xs text-text-muted mt-0.5">
                        {formatChangeMeta(row.resource_type, row.change_kind, row.status)} · v{row.version} ·{' '}
                        {formatGovernTimestamp(row.resolved_at ?? row.created_at)}
                      </p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="passports" className="mt-4">
            <Card>
              <CardContent className="space-y-2 pt-6">
                {passports.map((row) => (
                  <div key={String(row.id)} className="rounded-lg border border-border p-3">
                    <p className="text-sm font-medium text-text-heading">
                      {String(row.name)}{' '}
                      <span className="text-text-muted font-normal">({String(row.role)})</span>
                    </p>
                    <p className="text-xs text-text-muted mt-1">
                      Autonomy: {String(row.autonomy_level)}
                    </p>
                    <p className="text-xs text-text-muted mt-1 break-words">
                      Scopes:{' '}
                      {Array.isArray(row.permission_scopes)
                        ? (row.permission_scopes as string[]).join(', ') || 'role defaults'
                        : 'role defaults'}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit" className="mt-4">
            <Card>
              <CardContent className="space-y-2 pt-6">
                {audit.length === 0 ? (
                  <p className="text-sm text-text-muted">{t('audit.empty')}</p>
                ) : (
                  audit.slice(0, 30).map((event) => (
                    <div key={event.id} className="text-sm border-b border-border pb-2 last:border-0">
                      <p className="font-medium text-text-heading">{event.summary || event.action}</p>
                      <p className="text-xs text-text-muted mt-0.5">
                        {event.actor_type} · {event.outcome}
                        {event.created_at ? ` · ${formatGovernTimestamp(event.created_at)}` : null}
                      </p>
                    </div>
                  ))
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
              {pendingConfirm?.type === 'accept' ? t('drafts.acceptTitle', { defaultValue: 'Accept change' }) : t('drafts.rejectTitle', { defaultValue: 'Reject change' })}
            </DialogTitle>
            <DialogDescription>
              {pendingConfirm?.type === 'accept'
                ? t('drafts.acceptConfirm')
                : t('drafts.rejectConfirm', { defaultValue: 'Reject this change? It will not be applied.' })}
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
              {pendingConfirm?.type === 'accept' ? t('drafts.acceptAction', { defaultValue: 'Accept' }) : t('drafts.rejectAction', { defaultValue: 'Reject' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContent>
  )
}
