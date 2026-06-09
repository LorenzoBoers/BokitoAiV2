import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useAgendaCalendars } from '../../hooks/useAgendaCalendars'
import {
  completeExternalCalendarConnect,
  createCalendar,
  startExternalCalendarConnect,
  type AgendaCalendar,
} from '../../lib/agenda-api'
import { useAuth } from '../../context/AuthContext'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { ApiErrorBanner } from '../ui/ApiErrorBanner'
import { LoadingBlock } from '../ui/loading-block'

const VISIBILITY_KEY = 'agenda_calendar_visible'

function loadVisibility(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(VISIBILITY_KEY)
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

function saveVisibility(state: Record<string, boolean>) {
  try {
    localStorage.setItem(VISIBILITY_KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
}

export function getVisibleCalendarIds(calendars: AgendaCalendar[]): string[] {
  if (calendars.length === 0) return []
  const stored = loadVisibility()
  const currentIds = new Set(calendars.map((c) => c.id))
  const pruned: Record<string, boolean> = {}
  for (const [id, value] of Object.entries(stored)) {
    if (currentIds.has(id)) pruned[id] = value
  }
  if (Object.keys(pruned).length !== Object.keys(stored).length) {
    saveVisibility(pruned)
  }
  const visible = calendars.filter((c) => pruned[c.id] !== false).map((c) => c.id)
  if (visible.length === 0) return calendars.map((c) => c.id)
  return visible
}

type AgendaSidebarProps = {
  onVisibilityChange?: () => void
}

export default function AgendaSidebar({ onVisibilityChange }: AgendaSidebarProps) {
  const { t } = useTranslation('agenda')
  const { token } = useAuth()
  const { calendars, loading, error, refresh } = useAgendaCalendars()
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [visibility, setVisibility] = useState<Record<string, boolean>>(() => loadVisibility())

  const sorted = useMemo(
    () =>
      [...calendars].sort((a, b) => {
        if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1
        return a.name.localeCompare(b.name)
      }),
    [calendars],
  )

  const toggle = (id: string) => {
    const next = { ...visibility, [id]: visibility[id] === false }
    setVisibility(next)
    saveVisibility(
      Object.fromEntries(
        calendars.map((c) => [c.id, next[c.id] !== false]),
      ),
    )
    onVisibilityChange?.()
    window.dispatchEvent(new CustomEvent('agenda-calendar-visibility'))
  }

  const handleCreate = async () => {
    if (!token || !newName.trim()) return
    setBusy(true)
    try {
      await createCalendar(newName.trim(), token)
      setNewName('')
      toast.success(t('nav.calendarCreated', { defaultValue: 'Calendar created' }))
      await refresh()
    } catch {
      toast.error(t('nav.calendarCreateFailed', { defaultValue: 'Could not create calendar' }))
    } finally {
      setBusy(false)
    }
  }

  const handleConnect = async (provider: 'google' | 'outlook') => {
    if (!token) return
    setBusy(true)
    try {
      const returnUrl = `${window.location.origin}/agenda/month`
      const { authorize_url: url } = await startExternalCalendarConnect(provider, returnUrl, token)
      window.location.href = url
    } catch {
      await completeExternalCalendarConnect(provider, token)
      await refresh()
      onVisibilityChange?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
        {t('nav.calendars')}
      </p>
      {error ? <ApiErrorBanner message={error} className="mx-1" /> : null}
      {loading ? <LoadingBlock label={t('loading')} /> : null}
      <div className="space-y-0.5">
        {!loading &&
          sorted.map((cal) => {
            const checked = visibility[cal.id] !== false
            return (
              <label
                key={cal.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-transparent px-3 py-1.5 text-[13px] font-medium text-text-secondary hover:border-border/60 hover:bg-bg-hover/55"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(cal.id)}
                  className="rounded border-border"
                />
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: cal.color }}
                />
                <span className="min-w-0 truncate">{cal.name}</span>
              </label>
            )
          })}
        {!loading && sorted.length === 0 ? (
          <p className="px-3 text-xs text-text-muted">{t('empty.noCalendars')}</p>
        ) : null}
      </div>
      <div className="space-y-2 px-2">
        <div className="flex gap-1">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('nav.calendarName')}
            className="h-8 text-xs"
          />
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void handleCreate()}>
            <Plus size={14} />
          </Button>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="w-full justify-start text-xs"
          disabled={busy}
          onClick={() => void handleConnect('google')}
        >
          {t('nav.connectGoogle')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="w-full justify-start text-xs"
          disabled={busy}
          onClick={() => void handleConnect('outlook')}
        >
          {t('nav.connectOutlook')}
        </Button>
      </div>
    </div>
  )
}
