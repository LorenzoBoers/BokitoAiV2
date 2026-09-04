import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { TableRowsSkeleton } from '../ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Switch } from '../ui/switch'
import { ApiErrorBanner, formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { cn } from '../../lib/utils'
import { useAuth } from '../../context/AuthContext'
import {
  deleteTrigger,
  listTriggers,
  runTrigger,
  updateTrigger,
  type Trigger,
} from '../../lib/orchestration-api'
import { translateDecisionText } from '../../lib/activity-labels'
import { formatAppDateTime } from '../../lib/app-locale'
import { Input } from '../ui/input'
import { WebhookTriggerPanel } from './WebhookTriggerPanel'

function formatWhen(value: string, language?: string | null) {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : formatAppDateTime(d, language)
}

function triggerSchedule(
  trigger: Trigger,
  t: (key: string, opts?: { count?: number }) => string,
  language?: string | null,
): string {
  if (trigger.kind === 'cron') return trigger.cron_expr
  if (trigger.kind === 'webhook') return t('agendaPage.schedule.webhook')
  if (trigger.kind === 'once' || trigger.kind === 'event') {
    const at = trigger.next_run_at ?? trigger.last_run_at
    return at ? formatWhen(at, language) : t('agendaPage.schedule.unscheduled')
  }
  const minutes = trigger.interval_minutes || 60
  if (minutes % 1440 === 0) {
    const days = minutes / 1440
    return days === 1
      ? t('agendaPage.schedule.everyDay')
      : t('agendaPage.schedule.everyDays', { count: days })
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return hours === 1
      ? t('agendaPage.schedule.everyHour')
      : t('agendaPage.schedule.everyHours', { count: hours })
  }
  return minutes === 1
    ? t('agendaPage.schedule.everyMinute')
    : t('agendaPage.schedule.everyMinutes', { count: minutes })
}

type AutomationsPanelProps = {
  /** Bump to force a reload (e.g. after the trigger dialog saves). */
  reloadKey?: number
  onCreateTrigger?: () => void
  onEditTrigger?: (trigger: Trigger) => void
}

export default function AutomationsPanel({ reloadKey = 0, onCreateTrigger, onEditTrigger }: AutomationsPanelProps) {
  const { t, i18n } = useTranslation('nav')
  const { token } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [triggers, setTriggers] = useState<Trigger[]>([])
  const [runningId, setRunningId] = useState<string | null>(null)
  const [triggerQuery, setTriggerQuery] = useState('')

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const triggerRows = await listTriggers()
      setTriggers(Array.isArray(triggerRows) ? triggerRows : [])
    } catch (err) {
      setError(formatApiErrorMessage(err, t('agendaPage.loadAutomationsError')))
    } finally {
      setLoading(false)
    }
  }, [token, t])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const fireTrigger = async (triggerId: string) => {
    setRunningId(triggerId)
    try {
      const result = await runTrigger(triggerId)
      if (result.status === 'no_agent') {
        toast.error(t('agendaPage.noTarget'))
      } else if (result.status === 'agent_archived') {
        toast.error(t('agendaPage.agentArchived'))
      } else {
        toast.success(t('agendaPage.triggerFired', { status: result.status || 'ok' }))
      }
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('agendaPage.runTriggerError')))
    } finally {
      setRunningId(null)
    }
  }

  const toggleTrigger = async (trigger: Trigger) => {
    setRunningId(trigger.id)
    try {
      await updateTrigger(trigger.id, { enabled: !trigger.enabled })
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('agendaPage.updateTriggerError')))
    } finally {
      setRunningId(null)
    }
  }

  const removeTrigger = async (triggerId: string) => {
    if (!window.confirm(t('agendaPage.removeTriggerConfirm'))) return
    setRunningId(triggerId)
    try {
      await deleteTrigger(triggerId)
      toast.success(t('agendaPage.triggerDeleted'))
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('agendaPage.deleteTriggerError')))
    } finally {
      setRunningId(null)
    }
  }

  const visibleTriggers = useMemo(() => {
    const q = triggerQuery.trim().toLowerCase()
    if (!q) return triggers
    return triggers.filter((trigger) => {
      const hay = `${trigger.name} ${trigger.kind} ${trigger.cron_expr ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [triggers, triggerQuery])

  if (loading) return <TableRowsSkeleton rows={6} />

  return (
    <div className="space-y-4">
      {error ? <ApiErrorBanner message={error} onRetry={() => void load()} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('agendaPage.allTriggers')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {triggers.length > 3 ? (
            <Input
              value={triggerQuery}
              onChange={(event) => setTriggerQuery(event.target.value)}
              placeholder={t('agendaPage.searchTriggers')}
              className="h-8 text-xs"
              aria-label={t('agendaPage.searchTriggers')}
            />
          ) : null}
          {triggers.length === 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-text-muted">
                {t('agendaPage.noTriggers')}
              </p>
              <div className="flex flex-wrap gap-2">
                {onCreateTrigger ? (
                  <Button type="button" size="sm" onClick={onCreateTrigger}>
                    {t('agendaPage.createAutomation')}
                  </Button>
                ) : null}
                <Button type="button" size="sm" variant="outline" asChild>
                  <Link to="/workstreams">{t('agendaPage.openWorkstreams')}</Link>
                </Button>
                <Button type="button" size="sm" variant="outline" asChild>
                  <Link to="/agenda">{t('agendaPage.backToAgenda')}</Link>
                </Button>
              </div>
            </div>
          ) : (
            visibleTriggers.length === 0 ? (
              <p className="text-sm text-text-muted">{t('agendaPage.triggerFilterEmpty')}</p>
            ) : (
            visibleTriggers.map((trigger) => (
              <div key={trigger.id} className="row-interactive rounded-lg border-b border-border px-1 py-2 last:border-0">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        trigger.enabled
                          ? 'pulse-dot bg-status-success shadow-[0_0_6px_rgba(52,211,153,0.55)]'
                          : 'border border-border bg-transparent',
                      )}
                    />
                    <div className={cn('min-w-0', !trigger.enabled && 'opacity-55')}>
                      <span
                        className={cn(
                          'font-medium',
                          trigger.enabled ? 'text-text-heading' : 'text-text-muted',
                        )}
                      >
                        {translateDecisionText(trigger.name, t)}
                      </span>
                      <span className="ml-2 text-text-muted">
                        {(() => {
                          const displayName = translateDecisionText(trigger.name, t)
                          const kindLabel = t(`triggerDialog.kinds.${trigger.kind}`, {
                            defaultValue: trigger.kind,
                          })
                          const name = displayName.trim().toLowerCase()
                          const hideKind =
                            name === kindLabel.toLowerCase() ||
                            name === String(trigger.kind).toLowerCase()
                          const schedule = triggerSchedule(trigger, t, i18n.language)
                          return hideKind
                            ? ` · ${schedule}`
                            : ` · ${kindLabel} · ${schedule}`
                        })()}
                      </span>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        'shrink-0 text-[10px]',
                        trigger.enabled
                          ? 'border-status-success/40 text-status-success'
                          : 'border-border text-text-muted',
                      )}
                    >
                      {trigger.enabled ? t('agendaPage.active') : t('agendaPage.paused')}
                    </Badge>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {onEditTrigger ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => onEditTrigger(trigger)}>
                        {t('agendaPage.edit')}
                      </Button>
                    ) : null}
                    <Switch
                      checked={trigger.enabled}
                      disabled={runningId === trigger.id}
                      aria-label={
                        trigger.enabled
                          ? t('agendaPage.pauseTrigger', { name: translateDecisionText(trigger.name, t) })
                          : t('agendaPage.activateTrigger', { name: translateDecisionText(trigger.name, t) })
                      }
                      onCheckedChange={() => void toggleTrigger(trigger)}
                      className="h-5 w-9 [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-[16px]"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-status-error"
                      disabled={runningId === trigger.id}
                      onClick={() => void removeTrigger(trigger.id)}
                    >
                      {t('agendaPage.delete')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={runningId === trigger.id}
                      onClick={() => void fireTrigger(trigger.id)}
                    >
                      {runningId === trigger.id ? t('agendaPage.running') : t('agendaPage.runNow')}
                    </Button>
                  </div>
                </div>
                {trigger.kind === 'webhook' ? (
                  <div className="mt-2">
                    <WebhookTriggerPanel trigger={trigger} compact onUpdated={() => void load()} />
                  </div>
                ) : null}
              </div>
            ))
            )
          )}
        </CardContent>
      </Card>
    </div>
  )
}
