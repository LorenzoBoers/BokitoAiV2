import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarClock, Check, ListChecks, Sparkles, X } from 'lucide-react'
import type {
  Ticket,
  TicketChecklistItem,
  TicketDueSource,
  TicketNextStep,
} from '../../lib/tickets-api'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

const INLINE =
  'h-7 min-w-0 flex-1 border-transparent bg-transparent px-1.5 text-xs text-text-heading hover:border-border'

type PatchBody = {
  due_at?: string | null
  due_source?: TicketDueSource
  due_basis?: string
  checklist?: Record<string, 'done' | 'open'>
}

const DUE_SOURCES: TicketDueSource[] = ['statutory', 'requested', 'agreed', 'manual']

const DUE_TONE: Record<string, string> = {
  overdue: 'text-status-error',
  soon: 'text-status-warning',
  later: 'text-text-muted',
}

/** "Due in 3 days" / "2 days overdue" from the server's next step. */
export function TicketDueBadge({ step, className }: { step: TicketNextStep | null | undefined; className?: string }) {
  const { t } = useTranslation('nav')
  if (!step?.due_at || step.days_left == null) return null
  const days = step.days_left
  const label =
    step.due_state === 'overdue'
      ? t('tickets.dueOverdue', { count: Math.max(1, -days) })
      : days === 0
        ? t('tickets.dueToday')
        : t('tickets.dueIn', { count: days })
  return (
    <span
      className={cn('inline-flex items-center gap-0.5 tabular-nums', DUE_TONE[step.due_state] ?? 'text-text-muted', className)}
      title={`${new Date(step.due_at).toLocaleDateString()}${step.due_source ? ` · ${t(`tickets.dueSource.${step.due_source}`)}` : ''}`}
    >
      <CalendarClock size={11} aria-hidden />
      {label}
    </span>
  )
}

/** Who the ticket waits on and what is still open, as one quiet line. */
export function TicketNextStepLine({ step, className }: { step: TicketNextStep | null | undefined; className?: string }) {
  const { t } = useTranslation('nav')
  if (!step) return null
  const parts: string[] = []
  if (step.waiting_on) parts.push(t(`tickets.waitingOn.${step.waiting_on}`))
  if (step.missing.length) parts.push(t('tickets.missingItems', { count: step.missing.length }))
  if (step.to_confirm) parts.push(t('tickets.toConfirm', { count: step.to_confirm }))
  if (!parts.length) return null
  return (
    <p
      className={cn('truncate text-2xs text-text-muted', className)}
      title={step.missing.length ? step.missing.join(', ') : undefined}
    >
      {parts.join(' · ')}
    </p>
  )
}

function dateInputValue(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : ''
}

/** Deadline, current-stage checklist and open proposals on the ticket panel. */
export function TicketWorkSection({
  ticket,
  busy,
  onPatch,
}: {
  ticket: Ticket
  busy: boolean
  onPatch: (body: PatchBody) => void
}) {
  const { t } = useTranslation('nav')
  const due = ticket.due ?? { at: null, source: null, basis: '' }
  const [basis, setBasis] = useState(due.basis)
  useEffect(() => setBasis(due.basis), [due.basis])
  const items = (ticket.checklist ?? []).filter((item) => item.stage_key === ticket.stage_key)
  const proposals = ticket.proposals ?? []

  return (
    <div className="space-y-2 border-t border-border px-3 py-2">
      <TicketNextStepLine step={ticket.next_step} />

      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="w-[5.25rem] shrink-0 truncate text-2xs text-text-muted">{t('tickets.deadline')}</span>
          <Input
            type="date"
            value={dateInputValue(due.at)}
            disabled={busy}
            aria-label={t('tickets.deadline')}
            onChange={(event) => {
              const value = event.target.value
              onPatch(value ? { due_at: value, due_source: due.source ?? 'manual' } : { due_at: null })
            }}
            className={INLINE}
          />
          {due.at ? (
            <>
              <Select
                value={due.source ?? 'manual'}
                disabled={busy}
                onValueChange={(value) => onPatch({ due_source: value as TicketDueSource })}
              >
                <SelectTrigger
                  className="h-7 w-auto border-transparent bg-transparent px-1.5 text-2xs text-text-secondary shadow-none hover:border-border"
                  aria-label={t('tickets.deadline')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DUE_SOURCES.map((source) => (
                    <SelectItem key={source} value={source}>
                      {t(`tickets.dueSource.${source}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="iconSm"
                disabled={busy}
                onClick={() => onPatch({ due_at: null })}
                className="text-text-muted"
                title={t('tickets.deadlineClear')}
                aria-label={t('tickets.deadlineClear')}
              >
                <X size={12} aria-hidden />
              </Button>
            </>
          ) : null}
        </div>
        {due.at ? (
          <div className="flex items-center gap-1.5">
            <TicketDueBadge step={ticket.next_step} className="w-[5.25rem] shrink-0 text-2xs" />
            <Input
              value={basis}
              disabled={busy}
              placeholder={t('tickets.deadlineBasisPlaceholder')}
              aria-label={t('tickets.deadlineBasis')}
              onChange={(event) => setBasis(event.target.value)}
              onBlur={() => {
                if (basis.trim() !== due.basis.trim()) onPatch({ due_basis: basis })
              }}
              className={cn(INLINE, 'text-text-secondary placeholder:text-text-muted')}
            />
          </div>
        ) : null}
      </div>

      {items.length > 0 ? (
        <div>
          <p className="mb-0.5 flex items-center gap-1 text-2xs text-text-muted">
            <ListChecks size={11} aria-hidden />
            {t('tickets.checklist')}
          </p>
          <ul className="space-y-0.5">
            {items.map((item) => (
              <ChecklistRow key={item.key} item={item} busy={busy} onPatch={onPatch} />
            ))}
          </ul>
        </div>
      ) : null}

      {proposals.length > 0 ? (
        <p className="flex items-center gap-1 text-2xs text-status-warning">
          <Sparkles size={11} aria-hidden />
          {t('tickets.proposalsWaiting', { count: proposals.length })}
        </p>
      ) : null}
    </div>
  )
}

function ChecklistRow({
  item,
  busy,
  onPatch,
}: {
  item: TicketChecklistItem
  busy: boolean
  onPatch: (body: PatchBody) => void
}) {
  const { t } = useTranslation('nav')
  const done = item.status === 'done'
  const proposed = item.status === 'proposed'
  return (
    <li className="flex items-center gap-1.5 text-xs">
      <Button
        type="button"
        variant="ghost"
        role="checkbox"
        aria-checked={done ? 'true' : proposed ? 'mixed' : 'false'}
        disabled={busy}
        onClick={() => onPatch({ checklist: { [item.key]: done ? 'open' : 'done' } })}
        title={proposed ? t('tickets.checklistProposed') : t(`tickets.checklistEvidence.${item.evidence ?? 'manual'}`)}
        className={cn(
          'h-3.5 w-3.5 shrink-0 rounded border p-0 transition',
          done
            ? 'border-status-success bg-status-success text-white hover:bg-status-success'
            : proposed
              ? 'border-status-warning bg-status-warning/15 text-status-warning'
              : 'border-border hover:border-accent',
        )}
      >
        {done || proposed ? <Check size={10} aria-hidden /> : null}
      </Button>
      <span className={cn('min-w-0 flex-1 truncate', done ? 'text-text-muted line-through' : 'text-text-secondary')}>
        {item.label}
        {item.required ? <span className="ml-0.5 text-text-muted">*</span> : null}
      </span>
      {proposed ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={() => onPatch({ checklist: { [item.key]: 'done' } })}
          className="shrink-0 px-1 text-2xs text-accent"
        >
          {t('tickets.checklistConfirm')}
        </Button>
      ) : null}
    </li>
  )
}
