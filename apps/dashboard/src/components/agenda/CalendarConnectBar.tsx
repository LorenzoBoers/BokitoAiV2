import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarDays, RefreshCw } from 'lucide-react'
import { Button } from '../ui/button'
import { BrandMark } from '../integrations/BrandMark'
import {
  listCalendarConnections,
  syncAllCalendars,
  type CalendarConnection,
} from '../../lib/calendars-api'
import { connectedPathWithKind, marketplacePathWithKind } from '../../lib/integration-kind-url'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { cn } from '../../lib/utils'

function calendarBrandSlug(provider: string): string {
  const slug = provider.trim().toLowerCase()
  if (slug.includes('outlook') || slug.includes('microsoft')) return 'outlook-calendar'
  if (slug.includes('google')) return 'google-calendar'
  return slug
}

type CalendarConnectBarProps = {
  connections: CalendarConnection[]
  loading?: boolean
  onConnectionsChange: (rows: CalendarConnection[]) => void
  onSynced: () => void
  /** ``rail``: a compact list for the Agenda side rail. */
  variant?: 'bar' | 'rail'
}

export function CalendarConnectBar({
  connections,
  loading,
  onConnectionsChange,
  onSynced,
  variant = 'bar',
}: CalendarConnectBarProps) {
  const { t } = useTranslation('nav')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)


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

  if (variant === 'rail') {
    return (
      <div className="space-y-1.5">
        {connections.map((connection) => (
          <p key={connection.id} className="flex min-w-0 items-center gap-2 text-xs text-text-heading">
            <BrandMark slug={calendarBrandSlug(connection.provider)} size={14} />
            <span className="truncate">{connection.display_name}</span>
          </p>
        ))}
        {connections.length > 0 ? (
          <button
            type="button"
            disabled={busy != null}
            onClick={() => void sync()}
            className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-accent disabled:opacity-60"
          >
            <RefreshCw className={cn('h-3 w-3', busy === 'sync' && 'animate-spin')} aria-hidden />
            {t('agendaPage.calendar.syncNow')}
          </button>
        ) : (
          <div className="space-y-1.5 px-0.5">
            <p className="text-xs leading-relaxed text-text-muted">{t('agendaPage.rail.connectCalendarsBanner')}</p>
            <Link
              to={connectedPathWithKind('calendar')}
              className="inline-block text-xs font-medium text-accent hover:underline"
            >
              {t('agendaPage.rail.openConnections')}
            </Link>
          </div>
        )}
        {error ? <p className="text-xs text-status-error">{error}</p> : null}
      </div>
    )
  }

  if (connections.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-bg-elevated/40 px-4 py-3" data-testid="agenda-connect-calendars-banner">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm font-medium text-text-heading">
              <CalendarDays className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
              {t('agendaPage.calendar.connectTitle')}
            </p>
            <p className="mt-1 text-xs text-text-muted">{t('agendaPage.rail.connectCalendarsBanner')}</p>
            {error ? <p className="mt-2 text-xs text-status-error">{error}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" asChild>
              <Link to={connectedPathWithKind('calendar')}>{t('agendaPage.rail.openConnections')}</Link>
            </Button>
            <Button type="button" size="sm" variant="ghost" asChild>
              <Link to={marketplacePathWithKind('calendar')}>{t('agendaPage.calendar.openMarketplace')}</Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const eventCount = connections.reduce((n: number, c) => n + (c.event_count ?? 0), 0)

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-bg-surface px-3 py-2 text-xs">
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-text-muted">
        <span className="font-medium text-text-heading">{t('agendaPage.calendar.connectedLabel')}</span>
        {connections.map((connection, index) => (
          <span key={connection.id} className="inline-flex items-center gap-1.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-bg-elevated ring-1 ring-border/60">
              <BrandMark slug={calendarBrandSlug(connection.provider)} size={14} />
            </span>
            <span>
              {connection.display_name}
              {index < connections.length - 1 ? ',' : ''}
            </span>
          </span>
        ))}
        {eventCount > 0 ? (
          <span>· {t('agendaPage.calendar.eventCount', { count: eventCount })}</span>
        ) : null}
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
