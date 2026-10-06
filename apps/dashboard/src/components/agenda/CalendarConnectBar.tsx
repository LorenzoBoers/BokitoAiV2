import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarDays, RefreshCw } from 'lucide-react'
import { Button } from '../ui/button'
import { BrandMark } from '../integrations/BrandMark'
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
          <>
            <p className="text-xs text-text-muted">{t('agendaPage.rail.calendarsEmpty')}</p>
            <div className="flex flex-col gap-1">
              {(['google_calendar', 'outlook_calendar'] as const).map((slug) => (
                <button
                  key={slug}
                  type="button"
                  disabled={busy != null}
                  onClick={() => void connect(slug)}
                  className="inline-flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs text-text-heading hover:bg-bg-elevated disabled:opacity-60"
                >
                  <BrandMark slug={calendarBrandSlug(slug)} size={14} />
                  {slug === 'google_calendar' ? t('agendaPage.calendar.connectGoogle') : t('agendaPage.calendar.connectOutlook')}
                </button>
              ))}
            </div>
          </>
        )}
        {error ? <p className="text-xs text-status-error">{error}</p> : null}
      </div>
    )
  }

  if (connections.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-bg-elevated/40 px-4 py-3">
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
              <BrandMark slug="google-calendar" size={14} className="mr-1.5" />
              {t('agendaPage.calendar.connectGoogle')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy != null}
              onClick={() => void connect('outlook_calendar')}
            >
              <BrandMark slug="outlook-calendar" size={14} className="mr-1.5" />
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
