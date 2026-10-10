import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'
import { ChoiceSelect } from '../ui/ChoiceSelect'
import { useConfirm } from '../ui/confirm-dialog'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { CalendarSwatch } from '../agenda/CalendarSwatch'
import { BrandMark } from './BrandMark'
import { ConnectionScopeEditor } from './ConnectionScopeEditor'
import {
  CALENDAR_PROVIDERS,
  calendarBrandSlug,
  listAccountCalendars,
  listCalendarConnections,
  saveAccountCalendars,
  startCalendarConnect,
  syncCalendarConnection,
  utcIso,
  type CalendarConnection,
  type CalendarInfo,
  type CalendarProvider,
} from '../../lib/calendars-api'
import { revokeIntegrationConnection } from '../../lib/integrations-api'
import { timeAgo } from '../../lib/time-ago'
import { cn } from '../../lib/utils'

/** Google and Microsoft calendar accounts on the Connections page (Agenda filter). */
export function CalendarAccountsSection() {
  const { t } = useTranslation('calendar')
  const [rows, setRows] = useState<CalendarConnection[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<CalendarProvider | null>(null)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      setRows(await listCalendarConnections())
    } catch (err) {
      setRows([])
      setError(formatApiErrorMessage(err, t('accounts.loadError')))
    }
  }, [t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const connect = async (provider: CalendarProvider) => {
    setConnecting(provider)
    try {
      await startCalendarConnect(provider)
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('accounts.connectError')))
      setConnecting(null)
    }
  }

  const hasAny = (rows?.length ?? 0) > 0

  return (
    <section className="space-y-3" data-testid="calendar-accounts">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold text-text-muted">{t('accounts.title')}</h2>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">{t('accounts.hint')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {CALENDAR_PROVIDERS.map((provider) => (
            <Button
              key={provider}
              type="button"
              size="sm"
              variant={hasAny ? 'secondary' : 'default'}
              className="gap-1.5"
              disabled={connecting != null}
              onClick={() => void connect(provider)}
              data-testid={`calendar-connect-${provider}`}
            >
              {connecting === provider ? (
                <Loader2 size={14} className="animate-spin" aria-hidden />
              ) : hasAny ? (
                <Plus size={14} aria-hidden />
              ) : (
                <BrandMark slug={calendarBrandSlug(provider)} size={14} />
              )}
              {provider === 'google_calendar'
                ? t(hasAny ? 'accounts.addGoogle' : 'accounts.connectGoogle')
                : t(hasAny ? 'accounts.addOutlook' : 'accounts.connectOutlook')}
            </Button>
          ))}
        </div>
      </div>
      {error ? <p className="text-xs text-status-error">{error}</p> : null}
      {rows == null ? (
        <div className="flex justify-center py-4">
          <Loader2 size={16} className="animate-spin text-text-muted" aria-hidden />
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/60 px-4 py-3 text-sm text-text-muted">
          {t('accounts.empty')}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <CalendarAccountRow
              key={row.id}
              row={row}
              onReconnect={() => void connect(row.provider as CalendarProvider)}
              onChanged={refresh}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function StatusLine({ row }: { row: CalendarConnection }) {
  const { t } = useTranslation('calendar')
  const status = row.sync_status || 'idle'
  if (status === 'reconnect') {
    return (
      <span className="inline-flex items-center gap-1 text-status-warning">
        <AlertTriangle size={12} aria-hidden />
        {t('status.reconnect')}
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-status-error">
        <AlertTriangle size={12} aria-hidden />
        {t('status.error', { error: row.sync_error || '' })}
      </span>
    )
  }
  if (status === 'ok' && row.last_synced_at) {
    return <span>{t('status.ok', { when: timeAgo(utcIso(row.last_synced_at), t) })}</span>
  }
  return <span>{t('status.idle')}</span>
}

function CalendarAccountRow({
  row,
  onReconnect,
  onChanged,
}: {
  row: CalendarConnection
  onReconnect: () => void
  onChanged: () => Promise<void>
}) {
  const { t } = useTranslation('calendar')
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const canManage = Boolean(row.can_manage)
  const needsSignIn = row.sync_status === 'reconnect'

  const sync = async () => {
    setSyncing(true)
    try {
      await syncCalendarConnection(row.id)
      await onChanged()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('actions.syncError')))
    } finally {
      setSyncing(false)
    }
  }

  const disconnect = async () => {
    if (
      !(await confirm({
        description: t('actions.disconnectConfirm'),
        confirmLabel: t('actions.disconnect'),
        destructive: true,
      }))
    )
      return
    try {
      await revokeIntegrationConnection(row.id)
      await onChanged()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('actions.syncError')))
    }
  }

  const enabled = (row.calendars ?? []).filter((c) => c.enabled)

  return (
    <li className="rounded-lg border border-border/60 bg-bg-surface" data-testid="calendar-account-row">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
        <BrandMark slug={calendarBrandSlug(row.provider)} size={22} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text-heading">
            {row.account || row.display_name}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
            <StatusLine row={row} />
            {row.event_count ? <span>{t('accounts.eventCount', { count: row.event_count })}</span> : null}
            {!canManage ? <span>{t('accounts.shared')}</span> : null}
          </p>
          {enabled.length > 0 ? (
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-secondary">
              {enabled.map((cal) => (
                <span key={cal.id} className="inline-flex items-center gap-1.5">
                  <CalendarSwatch color={cal.color} />
                  {cal.name}
                </span>
              ))}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {needsSignIn && canManage ? (
            <Button type="button" size="sm" onClick={onReconnect}>
              {t('actions.reconnect')}
            </Button>
          ) : null}
          {canManage ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={syncing}
                onClick={() => void sync()}
              >
                <RefreshCw size={13} className={cn(syncing && 'animate-spin')} aria-hidden />
                {syncing ? t('actions.syncing') : t('actions.syncNow')}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
                {open ? t('actions.close') : t('actions.manage')}
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {open && canManage ? (
        <div className="space-y-5 border-t border-border/60 px-3 py-3">
          <CalendarPicker connectionId={row.id} onSaved={onChanged} />
          <ConnectionScopeEditor
            connectionId={row.id}
            projects={[]}
            showProjects={false}
            accessHint={t('access.hint')}
            onSaved={onChanged}
          />
          <div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-status-error"
              onClick={() => void disconnect()}
            >
              {t('actions.disconnect')}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  )
}

function CalendarPicker({ connectionId, onSaved }: { connectionId: string; onSaved: () => Promise<void> }) {
  const { t } = useTranslation('calendar')
  const [calendars, setCalendars] = useState<CalendarInfo[] | null>(null)
  const [defaultId, setDefaultId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    listAccountCalendars(connectionId)
      .then((res) => {
        if (!alive) return
        setCalendars(res.calendars)
        setDefaultId(res.default_write_calendar)
      })
      .catch((err) => {
        if (!alive) return
        setCalendars([])
        setError(formatApiErrorMessage(err, t('calendars.saveError')))
      })
    return () => {
      alive = false
    }
  }, [connectionId, t])

  const save = async (input: Parameters<typeof saveAccountCalendars>[1]) => {
    setBusy(true)
    setError(null)
    try {
      const res = await saveAccountCalendars(connectionId, input)
      setCalendars(res.calendars)
      setDefaultId(res.default_write_calendar)
      await onSaved()
    } catch (err) {
      setError(formatApiErrorMessage(err, t('calendars.saveError')))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string, on: boolean) => {
    if (!calendars) return
    void save({ calendars: calendars.map((c) => ({ id: c.id, enabled: c.id === id ? on : c.enabled })) })
  }

  if (calendars == null) {
    return <p className="text-xs text-text-muted">{t('calendars.loading')}</p>
  }

  const writable = calendars.filter((c) => c.enabled && c.writable)

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <div>
          <p className="text-xs font-medium text-text-heading">{t('calendars.title')}</p>
          <p className="mt-0.5 text-xs text-text-muted">{t('calendars.hint')}</p>
        </div>
        <ul className="space-y-1">
          {calendars.map((cal) => (
            <li key={cal.id} className="flex items-center gap-2.5 text-sm">
              <Switch
                checked={cal.enabled}
                disabled={busy}
                onCheckedChange={(on) => toggle(cal.id, on)}
                aria-label={cal.name}
              />
              <CalendarSwatch color={cal.color} />
              <span className="min-w-0 flex-1 truncate text-text-heading">{cal.name}</span>
              {cal.primary ? <span className="text-2xs text-text-muted">{t('calendars.primary')}</span> : null}
              {!cal.writable ? <span className="text-2xs text-text-muted">{t('calendars.readOnly')}</span> : null}
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-2">
        <div>
          <p className="text-xs font-medium text-text-heading">{t('calendars.default')}</p>
          <p className="mt-0.5 text-xs text-text-muted">{t('calendars.defaultHint')}</p>
        </div>
        {writable.length === 0 ? (
          <p className="text-xs text-text-muted">{t('calendars.noneWritable')}</p>
        ) : (
          <ChoiceSelect
            aria-label={t('calendars.default')}
            value={defaultId ?? undefined}
            disabled={busy}
            onValueChange={(value) => void save({ default_write_calendar: value })}
            groups={[
              {
                items: writable.map((cal) => ({
                  value: cal.id,
                  label: cal.name,
                  kind: 'icon' as const,
                  trailing: <CalendarSwatch color={cal.color} />,
                })),
              },
            ]}
          />
        )}
        {error ? <p className="text-xs text-status-error">{error}</p> : null}
      </div>
    </div>
  )
}
