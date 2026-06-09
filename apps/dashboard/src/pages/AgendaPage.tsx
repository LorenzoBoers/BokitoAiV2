import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { PageContent } from '../components/layout/PageContent'
import { Button } from '../components/ui/button'
import { LoadingBlock } from '../components/ui/loading-block'
import { ApiErrorBanner } from '../components/ui/ApiErrorBanner'
import AgendaSidebar, { getVisibleCalendarIds } from '../components/agenda/AgendaSidebar'
import MonthView from '../components/agenda/MonthView'
import WeekView from '../components/agenda/WeekView'
import DayView from '../components/agenda/DayView'
import ListView from '../components/agenda/ListView'
import EventDrawer from '../components/agenda/EventDrawer'
import { useAgendaCalendars } from '../hooks/useAgendaCalendars'
import { useAgendaEvents } from '../hooks/useAgendaEvents'
import {
  addDays,
  formatAgendaDateParam,
  formatDayLabel,
  formatMonthLabel,
  formatWeekLabel,
  parseAgendaDate,
  rangeForView,
} from '../lib/agenda-dates'
import type { AgendaEvent, AgendaView } from '../lib/agenda-api'
import { completeExternalCalendarConnect } from '../lib/agenda-api'
import { useAuth } from '../context/AuthContext'
import { cn } from '../lib/utils'

const VIEWS: AgendaView[] = ['month', 'week', 'day', 'list']

function normalizeView(raw: string | undefined): AgendaView {
  if (raw && VIEWS.includes(raw as AgendaView)) return raw as AgendaView
  return 'month'
}

export default function AgendaPage() {
  const { t } = useTranslation('agenda')
  const { view: viewParam } = useParams<{ view: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { token } = useAuth()
  const view = normalizeView(viewParam)
  const dateParam = searchParams.get('date')
  const anchor = useMemo(() => parseAgendaDate(dateParam), [dateParam])

  const { calendars, refresh: refreshCalendars } = useAgendaCalendars()
  const [visibilityTick, setVisibilityTick] = useState(0)
  useEffect(() => {
    const onVis = () => setVisibilityTick((n) => n + 1)
    window.addEventListener('agenda-calendar-visibility', onVis)
    return () => window.removeEventListener('agenda-calendar-visibility', onVis)
  }, [])
  const visibleIds = useMemo(() => {
    void visibilityTick
    return getVisibleCalendarIds(calendars)
  }, [calendars, visibilityTick])

  const range = useMemo(() => rangeForView(view, anchor), [view, anchor])
  const { events, loading, error, refresh: refreshEvents } = useAgendaEvents({
    start: range.start,
    end: range.end,
    calendarIds: visibleIds.length ? visibleIds : undefined,
  })

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<AgendaEvent | null>(null)
  const [defaultStartsAt, setDefaultStartsAt] = useState<string | undefined>()

  useEffect(() => {
    const provider = searchParams.get('oauth_provider')
    const status = searchParams.get('oauth_status')
    if (!token || !provider || status !== 'success') return
    if (provider !== 'google' && provider !== 'outlook') return
    void completeExternalCalendarConnect(provider, token).then(() => {
      refreshCalendars()
      toast.success(t('nav.calendarConnected', { defaultValue: 'Calendar connected' }))
      const next = new URLSearchParams(searchParams)
      next.delete('oauth_provider')
      next.delete('oauth_status')
      next.delete('oauth_scope')
      setSearchParams(next, { replace: true })
    })
  }, [token, searchParams, setSearchParams, refreshCalendars])

  const setAnchor = useCallback(
    (d: Date) => {
      const next = new URLSearchParams(searchParams)
      next.set('date', formatAgendaDateParam(d))
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const goToday = () => setAnchor(new Date())

  const goPrev = () => {
    if (view === 'month') setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))
    else if (view === 'week') setAnchor(addDays(anchor, -7))
    else setAnchor(addDays(anchor, -1))
  }

  const goNext = () => {
    if (view === 'month') setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))
    else if (view === 'week') setAnchor(addDays(anchor, 7))
    else setAnchor(addDays(anchor, 1))
  }

  const periodLabel =
    view === 'month'
      ? formatMonthLabel(anchor)
      : view === 'week'
        ? formatWeekLabel(anchor)
        : view === 'day'
          ? formatDayLabel(anchor)
          : formatMonthLabel(anchor)

  const openNew = (starts?: string) => {
    setSelectedEvent(null)
    setDefaultStartsAt(starts ?? anchor.toISOString())
    setDrawerOpen(true)
  }

  const openEvent = (ev: AgendaEvent) => {
    if (ev.readOnly && ev.kind === 'implementation') {
      window.open('/orchestra', '_self')
      return
    }
    setSelectedEvent(ev)
    setDefaultStartsAt(undefined)
    setDrawerOpen(true)
  }

  const handleRefresh = () => {
    void refreshCalendars()
    void refreshEvents()
  }

  return (
    <PageContent width="full" className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text-heading">{t('title')}</h1>
          <p className="text-sm text-text-muted mt-1">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/orchestra" className="text-sm text-accent hover:underline">
            Orchestra
          </Link>
          <Button type="button" size="sm" variant="outline" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4 mr-1', loading && 'animate-spin')} aria-hidden />
            {t('refresh', { defaultValue: 'Refresh' })}
          </Button>
          <Button type="button" size="sm" onClick={() => openNew()}>
            <Plus size={14} className="mr-1" />
            {t('event.new')}
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-2">
        {VIEWS.map((v) => (
          <Link
            key={v}
            to={`/agenda/${v}?date=${formatAgendaDateParam(anchor)}`}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              view === v
                ? 'bg-bg-hover text-text-heading border border-border/70'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {t(`views.${v}`)}
          </Link>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={goPrev} aria-label={t('nav.prev')}>
            <ChevronLeft size={16} />
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={goToday}>
            {t('nav.today')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={goNext} aria-label={t('nav.next')}>
            <ChevronRight size={16} />
          </Button>
          <span className="px-2 text-sm font-medium text-text-heading">{periodLabel}</span>
        </div>
      </div>

      {error ? <ApiErrorBanner message={error} onRetry={handleRefresh} /> : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/60 bg-bg">
        {loading ? (
          <LoadingBlock label={t('loading')} />
        ) : view === 'month' ? (
          <MonthView
            anchor={anchor}
            events={events}
            calendars={calendars}
            onSelectDay={(day) => void navigate(`/agenda/day?date=${formatAgendaDateParam(day)}`)}
            onSelectEvent={openEvent}
          />
        ) : view === 'week' ? (
          <WeekView anchor={anchor} events={events} calendars={calendars} onSelectEvent={openEvent} />
        ) : view === 'day' ? (
          <DayView anchor={anchor} events={events} calendars={calendars} onSelectEvent={openEvent} />
        ) : (
          <ListView events={events} calendars={calendars} onSelectEvent={openEvent} onCreateEvent={() => openNew()} />
        )}
      </div>

      <EventDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        event={selectedEvent}
        calendars={calendars}
        defaultCalendarId={calendars.find((c) => c.kind === 'user')?.id}
        defaultStartsAt={defaultStartsAt}
        onSaved={handleRefresh}
      />
    </PageContent>
  )
}
