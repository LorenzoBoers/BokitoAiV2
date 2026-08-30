import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarDays, Link2, RefreshCw } from 'lucide-react'
import { Button } from '../ui/button'
import { getRegistryEntryByPlatformSlug } from '../../lib/integrations/registry'
import { startProviderOAuth } from '../../lib/integration-oauth-flow'
import {
  listCalendarConnections,
  syncAllCalendars,
  type CalendarConnection,
} from '../../lib/calendars-api'
import { marketplacePathWithKind } from '../../lib/integration-kind-url'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { cn } from '../../lib/utils'

type CalendarConnectBarProps = {
  connections: CalendarConnection[]
  loading?: boolean
  onConnectionsChange: (rows: CalendarConnection[]) => void
  onSynced: () => void
}

export function CalendarConnectBar({
  connections,
  loading,
  onConnectionsChange,
  onSynced,
}: CalendarConnectBarProps) {
  const { t } = useTranslation('nav')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const connect = async (platformSlug: string) => {
    const entry = getRegistryEntryByPlatformSlug(platformSlug)
    if (!entry) return
    setBusy(platformSlug)
    setError(null)
    try {
      const returnUrl = `${window.location.origin}/agenda`
      const authorizeUrl = await startProviderOAuth(entry, returnUrl)
      window.location.assign(authorizeUrl)
    } catch (err) {
      setError(formatApiErrorMessage(err, t('agendaPage.calendar.connectError')))
      setBusy(null)
    }
  }

  const sync = async () => {
    setBusy('sync')
    setError(null)
    try {
      await syncAllCalendars()
      const rows = await listCalendarConnections()
      onConnectionsChange(rows)
      onSynced()
    } catch (err) {
      setError(formatApiErrorMessage(err, t('agendaPage.calendar.syncError')))
    } finally {
      setBusy(null)
    }
  }

  if (loading) return null

  if (connections.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-bg-elevated/40 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm font-medium text-text-heading">
              <CalendarDays className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
              {t('agendaPage.calendar.connectTitle')}
            </p>
            <p className="mt-1 text-xs text-text-muted">{t('agendaPage.calendar.connectBody')}</p>
            {error ? <p className="mt-2 text-xs text-status-error">{error}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy != null}
              onClick={() => void connect('google_calendar')}
            >
              <Link2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {t('agendaPage.calendar.connectGoogle')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy != null}
              onClick={() => void connect('outlook_calendar')}
            >
              <Link2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {t('agendaPage.calendar.connectOutlook')}
            </Button>
            <Button type="button" size="sm" variant="ghost" asChild>
              <Link to={marketplacePathWithKind('calendar')}>{t('agendaPage.calendar.openMarketplace')}</Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const labels = connections.map((c) => c.display_name).join(', ')

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-bg-surface px-3 py-2 text-xs">
      <p className="text-text-muted">
        <span className="font-medium text-text-heading">{t('agendaPage.calendar.connectedLabel')}</span>
        {' '}
        {labels}
        {connections.some((c) => (c.event_count ?? 0) > 0)
          ? ` · ${t('agendaPage.calendar.eventCount', {
              count: connections.reduce((n, c) => n + (c.event_count ?? 0), 0),
            })}`
          : null}
      </p>
      <div className="flex items-center gap-2">
        {error ? <span className="text-status-error">{error}</span> : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7"
          disabled={busy != null}
          onClick={() => void sync()}
        >
          <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', busy === 'sync' && 'animate-spin')} aria-hidden />
          {t('agendaPage.calendar.syncNow')}
        </Button>
      </div>
    </div>
  )
}
