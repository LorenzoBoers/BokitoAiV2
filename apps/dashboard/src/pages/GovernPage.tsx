import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, Check, X, ChevronDown, ChevronUp } from 'lucide-react'
import { PageContent } from '../components/layout/PageContent'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { LoadingBlock } from '../components/ui/loading-block'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import {
  acceptGovernChange,
  getApplyModes,
  listAcceptedChanges,
  listAgentPassports,
  listGovernAudit,
  listGovernChanges,
  rejectGovernChange,
  updateApplyModes,
  type AuditEventRow,
  type PlatformChangeRow,
} from '../lib/govern-api'

const APPLY_MODE_OPTIONS = ['draft', 'yolo', 'decision'] as const
const RESOURCE_TYPES = ['agent', 'workstream', 'blueprint_block', 'integration', 'mcp_server', 'canvas_node'] as const

function DiffPreview({ change }: { change: PlatformChangeRow }) {
  return (
    <pre className="mt-2 max-h-40 overflow-auto rounded bg-bg-muted p-2 text-[11px] text-text-muted">
      {JSON.stringify({ before: change.before, after: change.after }, null, 2)}
    </pre>
  )
}

export default function GovernPage() {
  const [changes, setChanges] = useState<PlatformChangeRow[]>([])
  const [history, setHistory] = useState<PlatformChangeRow[]>([])
  const [audit, setAudit] = useState<AuditEventRow[]>([])
  const [passports, setPassports] = useState<Array<Record<string, unknown>>>([])
  const [applyModes, setApplyModes] = useState<Record<string, string>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [savingModes, setSavingModes] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      listGovernChanges(),
      listAcceptedChanges(),
      listGovernAudit(),
      listAgentPassports(),
      getApplyModes(),
    ])
      .then(([changeResp, historyResp, auditResp, passportResp, modesResp]) => {
        setChanges(changeResp.items)
        setHistory(historyResp.items)
        setAudit(auditResp.items)
        setPassports(passportResp.items)
        setApplyModes(modesResp.tenant_modes ?? modesResp.defaults ?? {})
      })
      .catch((err) => setError(formatApiErrorMessage(err, 'Could not load govern data.')))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleAccept(id: string) {
    setBusyId(id)
    try {
      await acceptGovernChange(id)
      load()
    } catch (err) {
      setError(formatApiErrorMessage(err, 'Accept failed.'))
    } finally {
      setBusyId(null)
    }
  }

  async function handleReject(id: string) {
    setBusyId(id)
    try {
      await rejectGovernChange(id)
      load()
    } catch (err) {
      setError(formatApiErrorMessage(err, 'Reject failed.'))
    } finally {
      setBusyId(null)
    }
  }

  async function handleApplyModeChange(resourceType: string, mode: string) {
    const next = { ...applyModes, [resourceType]: mode }
    setApplyModes(next)
    setSavingModes(true)
    try {
      await updateApplyModes(next)
    } catch (err) {
      setError(formatApiErrorMessage(err, 'Could not save apply modes.'))
      load()
    } finally {
      setSavingModes(false)
    }
  }

  return (
    <PageContent width="xl" className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text-heading flex items-center gap-2">
          <ShieldCheck className="h-6 w-6" aria-hidden />
          Govern
        </h1>
        <p className="text-sm text-text-muted mt-1">
          Review platform drafts, audit agent self-maintenance, and manage apply modes.
        </p>
      </header>

      {error ? <ApiErrorBanner message={error} onRetry={load} /> : null}

      {loading ? (
        <LoadingBlock label="Loading govern data..." />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Pending drafts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {changes.length === 0 ? (
                <p className="text-sm text-text-muted">No pending platform changes.</p>
              ) : (
                changes.map((change) => (
                  <div key={change.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-text-heading">{change.summary}</p>
                        <p className="text-xs text-text-muted mt-1">
                          {change.resource_type} / {change.change_kind} - v{change.version} - {change.status}
                        </p>
                        <button
                          type="button"
                          className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                          onClick={() => setExpandedId(expandedId === change.id ? null : change.id)}
                        >
                          {expandedId === change.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          View diff
                        </button>
                        {expandedId === change.id ? <DiffPreview change={change} /> : null}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" disabled={busyId === change.id} onClick={() => handleAccept(change.id)}>
                          <Check className="h-4 w-4 mr-1" aria-hidden />
                          Accept
                        </Button>
                        <Button size="sm" variant="outline" disabled={busyId === change.id} onClick={() => handleReject(change.id)}>
                          <X className="h-4 w-4 mr-1" aria-hidden />
                          Reject
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Apply modes (yolo / draft / decision)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {RESOURCE_TYPES.map((rt) => (
                <div key={rt} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-text-heading">{rt}</span>
                  <select
                    className="rounded border border-border bg-bg-surface px-2 py-1 text-xs"
                    value={applyModes[rt] ?? 'draft'}
                    disabled={savingModes}
                    onChange={(e) => void handleApplyModeChange(rt, e.target.value)}
                  >
                    {APPLY_MODE_OPTIONS.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Version history</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {history.length === 0 ? (
                <p className="text-sm text-text-muted">No accepted changes yet.</p>
              ) : (
                history.slice(0, 15).map((row) => (
                  <div key={row.id} className="text-sm border-b border-border pb-2">
                    <p className="font-medium text-text-heading">{row.summary}</p>
                    <p className="text-xs text-text-muted">
                      {row.resource_type} v{row.version} - {row.resolved_at ?? row.created_at}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Agent passports</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {passports.map((row) => (
                <div key={String(row.id)} className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium text-text-heading">
                    {String(row.name)} ({String(row.role)})
                  </p>
                  <p className="text-xs text-text-muted mt-1">
                    Autonomy: {String(row.autonomy_level)} | Scopes:{' '}
                    {Array.isArray(row.permission_scopes)
                      ? (row.permission_scopes as string[]).join(', ') || 'role defaults'
                      : 'role defaults'}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent audit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {audit.slice(0, 20).map((event) => (
                <div key={event.id} className="text-sm border-b border-border pb-2">
                  <p className="font-medium text-text-heading">{event.summary || event.action}</p>
                  <p className="text-xs text-text-muted">
                    {event.actor_type} - {event.outcome}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </PageContent>
  )
}
