import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeft, BookOpenCheck, Loader2, RefreshCw, Send, XCircle } from 'lucide-react'
import { PageContent } from '../components/layout/PageContent'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Textarea } from '../components/ui/textarea'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { formatAppDateTime } from '../lib/app-locale'
import {
  cancelWorkstreamRun,
  getWorkstreamRun,
  promoteWorkstreamRun,
  resumeWorkstreamRun,
  type WorkstreamRunDetail as RunDetailPayload,
} from '../lib/workstreams-api'
import { runStatusBadgeVariant, workstreamPath } from '../lib/workstream-ui'

const OPEN_STATUSES = new Set(['running', 'waiting', 'awaiting_gate'])

export default function WorkstreamRunDetail() {
  const { t, i18n } = useTranslation('nav')
  const { runId } = useParams<{ runId: string }>()
  const isAdmin = useIsAdmin()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<RunDetailPayload | null>(null)
  const [resumeText, setResumeText] = useState('')
  const [acting, setActing] = useState(false)

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!runId) return
      if (!opts?.silent) setLoading(true)
      setError(null)
      try {
        setDetail(await getWorkstreamRun(runId))
      } catch (err) {
        setError(formatApiErrorMessage(err, t('workstreamsPage.loadError')))
      } finally {
        if (!opts?.silent) setLoading(false)
      }
    },
    [runId, t],
  )

  useEffect(() => {
    void load()
  }, [load])

  // Light polling while the run is still moving.
  useEffect(() => {
    if (!detail || !OPEN_STATUSES.has(detail.run.status)) return
    const timer = window.setInterval(() => void load({ silent: true }), 5000)
    return () => window.clearInterval(timer)
  }, [detail, load])

  const stepNames = useMemo(() => {
    const map = new Map<string, { name: string; position: number }>()
    for (const step of detail?.steps ?? []) {
      map.set(step.id, { name: step.name, position: step.position })
    }
    return map
  }, [detail])

  const resume = async () => {
    if (!runId) return
    setActing(true)
    try {
      await resumeWorkstreamRun(runId, resumeText.trim())
      setResumeText('')
      toast.success(t('workstreamsPage.runResumed'))
      await load({ silent: true })
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.runResumeError')))
    } finally {
      setActing(false)
    }
  }

  const cancel = async () => {
    if (!runId || !window.confirm(t('workstreamsPage.cancelConfirm'))) return
    setActing(true)
    try {
      await cancelWorkstreamRun(runId)
      toast.success(t('workstreamsPage.runCancelled'))
      await load({ silent: true })
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.runCancelError')))
    } finally {
      setActing(false)
    }
  }

  const promote = async () => {
    if (!runId) return
    setActing(true)
    try {
      await promoteWorkstreamRun(runId)
      toast.success(t('workstreamsPage.runPromoted'))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.runPromoteError')))
    } finally {
      setActing(false)
    }
  }

  const run = detail?.run
  const waitingForInput = run ? run.status === 'waiting' || run.status === 'awaiting_gate' : false

  return (
    <PageContent width="xl" className="space-y-4 py-1">
      <Link
        to={run ? workstreamPath(run.workstream_id) : '/workstreams'}
        className="inline-flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-text-primary"
      >
        <ArrowLeft size={14} />
        {t('workstreamsPage.backToWorkstream')}
      </Link>

      {loading ? (
        <CardGridSkeleton cards={2} className="lg:grid-cols-1" />
      ) : error || !detail || !run ? (
        <ApiErrorBanner message={error ?? t('workstreamsPage.notFound')} onRetry={() => void load()} />
      ) : (
        <>
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold text-text-heading">
                  {detail.workstream.name}
                </h1>
                <Badge variant={runStatusBadgeVariant(run.status)}>
                  {t(`workstreamsPage.status.${run.status}`, { defaultValue: run.status })}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-text-muted">
                {run.started_at
                  ? t('workstreamsPage.startedAt', {
                      time: formatAppDateTime(new Date(run.started_at), i18n.language),
                    })
                  : null}
                {run.completed_at
                  ? ` · ${t('workstreamsPage.completedAt', {
                      time: formatAppDateTime(new Date(run.completed_at), i18n.language),
                    })}`
                  : null}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
                <RefreshCw size={13} className="mr-1" />
                {t('workstreamsPage.refresh')}
              </Button>
              {run.status === 'completed' && isAdmin ? (
                <Button type="button" size="sm" variant="outline" disabled={acting} onClick={() => void promote()}>
                  <BookOpenCheck size={13} className="mr-1" />
                  {t('workstreamsPage.promote')}
                </Button>
              ) : null}
              {OPEN_STATUSES.has(run.status) && isAdmin ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-status-error hover:text-status-error"
                  disabled={acting}
                  onClick={() => void cancel()}
                >
                  <XCircle size={13} className="mr-1" />
                  {t('workstreamsPage.cancelRun')}
                </Button>
              ) : null}
            </div>
          </header>

          {run.error ? <ApiErrorBanner message={run.error} /> : null}

          {run.input_text ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('workstreamsPage.inputTitle')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-text-primary">{run.input_text}</p>
              </CardContent>
            </Card>
          ) : null}

          {waitingForInput && isAdmin ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {run.status === 'awaiting_gate'
                    ? t('workstreamsPage.gateTitle')
                    : t('workstreamsPage.waitingTitle')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {run.wait_until ? (
                  <p className="text-xs text-text-muted">
                    {t('workstreamsPage.deadlineAt', {
                      time: formatAppDateTime(new Date(run.wait_until), i18n.language),
                    })}
                  </p>
                ) : null}
                <Textarea
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                  placeholder={t('workstreamsPage.resumePlaceholder')}
                  className="min-h-[72px] text-sm"
                />
                <Button type="button" size="sm" disabled={acting} onClick={() => void resume()}>
                  {acting ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Send size={13} className="mr-1" />}
                  {t('workstreamsPage.resume')}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {run.summary ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('workstreamsPage.summaryTitle')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-text-primary">{run.summary}</p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('workstreamsPage.worklogTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {detail.step_outputs.length === 0 && detail.agent_runs.length === 0 ? (
                <p className="text-sm text-text-muted">{t('workstreamsPage.noWorklog')}</p>
              ) : null}

              {detail.step_outputs.map((output, index) => {
                const stepInfo = output.step_id ? stepNames.get(String(output.step_id)) : undefined
                return (
                  <div key={`${output.step_id ?? 'out'}-${index}`} className="rounded-lg border border-border/60 p-3">
                    <p className="text-sm font-medium text-text-heading">
                      {stepInfo ? `${stepInfo.position + 1}. ` : ''}
                      {String(output.name ?? stepInfo?.name ?? t('workstreamsPage.stepFallback'))}
                    </p>
                    {output.text ? (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-text-secondary">
                        {String(output.text)}
                      </p>
                    ) : null}
                  </div>
                )
              })}

              {detail.agent_runs.map((agentRun) => (
                <div key={agentRun.id} className="rounded-lg border border-border/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-text-heading">
                      {agentRun.agent_name || t('workstreamsPage.agentFallback')}
                      {agentRun.subject ? (
                        <span className="ml-2 font-normal text-text-muted">{agentRun.subject}</span>
                      ) : null}
                    </p>
                    <span className="flex items-center gap-2 text-xs text-text-muted">
                      {agentRun.started_at
                        ? formatAppDateTime(new Date(agentRun.started_at), i18n.language)
                        : null}
                      <Badge variant={runStatusBadgeVariant(agentRun.status)} className="capitalize">
                        {agentRun.status}
                      </Badge>
                    </span>
                  </div>
                  {agentRun.events.length > 0 ? (
                    <ol className="mt-2 space-y-1 border-l border-border/60 pl-3">
                      {agentRun.events.map((event, index) => (
                        <li key={index} className="text-xs text-text-secondary">
                          <span className="font-medium text-text-muted">{event.event_type}</span>
                          {event.message ? <span> · {event.message}</span> : null}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </PageContent>
  )
}
