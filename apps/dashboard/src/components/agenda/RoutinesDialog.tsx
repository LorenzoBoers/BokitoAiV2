import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Plus } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Switch } from '../ui/switch'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { formatAppDate, formatAppTime } from '../../lib/app-locale'
import { updateTrigger, type Trigger } from '../../lib/orchestration-api'
import { parseTimelineMs } from '../../lib/time-items'
import { triggerScheduleLabel, isFailed } from './agenda-style'
import { agendaStatusLabel } from '../../lib/status-labels'
import { cn } from '../../lib/utils'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  triggers: Trigger[]
  agentNames: Map<string, string>
  onEdit: (trigger: Trigger) => void
  onCreate: () => void
  onChanged: () => void
}

export default function RoutinesDialog({ open, onOpenChange, triggers, agentNames, onEdit, onCreate, onChanged }: Props) {
  const { t, i18n } = useTranslation('nav')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = triggers.filter((row) => !q || `${row.name} ${row.instructions}`.toLowerCase().includes(q))
    const map = new Map<string, Trigger[]>()
    for (const row of rows) {
      const key = row.agent_id ? agentNames.get(row.agent_id) ?? t('agendaPage.routines.otherAgent') : t('agendaPage.routines.noAgent')
      map.set(key, [...(map.get(key) ?? []), row])
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [triggers, agentNames, query, t])

  const toggle = async (row: Trigger) => {
    setBusy(row.id)
    setError(null)
    try {
      await updateTrigger(row.id, { enabled: !row.enabled })
      onChanged()
    } catch (err) {
      setError(formatApiErrorMessage(err, t('agendaPage.updateTriggerError')))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="agenda-routines">
        <DialogHeader>
          <DialogTitle>{t('agendaPage.routines.title')}</DialogTitle>
          <DialogDescription>{t('agendaPage.routines.body')}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('agendaPage.searchTriggers')}
            className="h-9"
          />
          <Button type="button" size="sm" onClick={onCreate}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            {t('agendaPage.routines.new')}
          </Button>
        </div>
        {error ? <p className="text-xs text-status-error">{error}</p> : null}
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {groups.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">
              {query ? t('agendaPage.triggerFilterEmpty') : t('agendaPage.noTriggers')}
            </p>
          ) : null}
          {groups.map(([agent, rows]) => (
            <section key={agent}>
              <h3 className="mb-1.5 text-xs font-semibold text-text-muted">{agent}</h3>
              <ul className="divide-y divide-border/40 overflow-hidden rounded-lg border border-border/60">
                {rows.map((row) => {
                  const next = parseTimelineMs(row.next_run_at)
                  return (
                    <li key={row.id} className={cn('flex items-center gap-3 px-3 py-2', !row.enabled && 'opacity-60')}>
                      <Switch
                        checked={row.enabled}
                        disabled={busy === row.id}
                        onCheckedChange={() => void toggle(row)}
                        aria-label={
                          row.enabled
                            ? t('agendaPage.pauseTrigger', { name: row.name })
                            : t('agendaPage.activateTrigger', { name: row.name })
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-text-heading">{row.name}</p>
                        <p className="truncate text-xs text-text-muted">
                          {triggerScheduleLabel(row, t)}
                          {row.enabled && Number.isFinite(next)
                            ? ` · ${t('agendaPage.routines.next', {
                                when: `${formatAppDate(new Date(next), i18n.language, { day: 'numeric', month: 'short' })} ${formatAppTime(new Date(next), i18n.language)}`,
                              })}`
                            : ''}
                        </p>
                      </div>
                      {row.last_status && isFailed(row.last_status) ? (
                        <span className="text-2xs text-status-error">{agendaStatusLabel(row.last_status, t)}</span>
                      ) : null}
                      <Button type="button" size="sm" variant="ghost" onClick={() => onEdit(row)} aria-label={t('agendaPage.edit')}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
