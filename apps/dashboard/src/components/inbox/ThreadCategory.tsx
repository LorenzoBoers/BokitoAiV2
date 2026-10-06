import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronDown, ClipboardCheck, FolderKanban, Plus, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { relativeMoment } from '../agenda/agenda-style'
import {
  checkupLabel,
  getTicket,
  moveTicketToStage,
  patchTicket,
  stageLabel,
  type ProjectChoice,
  type Ticket,
  type TicketStageField,
  type TicketStageKind,
} from '../../lib/tickets-api'
import { useCollectStageFields } from './TicketStageGate'
import { timeAgo } from '../../lib/time-ago'
import { workstreamPath } from '../../lib/workstream-ui'
import { cn } from '../../lib/utils'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Button } from '../ui/button'
import { StageProgressIcon } from '../workstreams/StageProgressIcon'
import { Hashtag } from '../ui/HashtagMark'
import { TicketFieldControl } from './TicketFieldControl'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

type Props = {
  signalId: string
  /** Changes when the conversation's category or stage changed elsewhere. */
  version?: string
}

type TFn = (key: string, opts?: Record<string, unknown>) => string

const SEGMENT_KIND: Record<TicketStageKind, string> = {
  open: 'bg-text-muted/70',
  waiting: 'bg-status-warning',
  done: 'bg-status-success',
  closed: 'bg-emerald-400',
}

const INLINE_INPUT =
  'h-7 w-full rounded-md border border-transparent bg-transparent px-1.5 text-xs text-text-heading outline-none transition placeholder:text-text-muted/70 hover:border-border/60 hover:bg-bg-input/40 focus:border-accent focus:bg-bg-input'

/** Project options for filing: the flow's projects, then No project. */
function ProjectItems({
  choices,
  current,
  disabled,
  onPick,
  t,
}: {
  choices: ProjectChoice[]
  current?: string | null
  disabled: boolean
  onPick: (projectId: string | null) => void
  t: TFn
}) {
  return (
    <>
      {choices.map((choice) => (
        <DropdownMenuItem
          key={choice.id}
          className="gap-2 text-xs"
          disabled={disabled || current === choice.id}
          onSelect={() => onPick(choice.id)}
        >
          <FolderKanban size={12} className="text-text-muted" />
          {choice.name}
        </DropdownMenuItem>
      ))}
      <DropdownMenuItem
        className="text-xs text-text-secondary"
        disabled={disabled || current === null}
        onSelect={() => onPick(null)}
      >
        {t('tickets.noProject')}
      </DropdownMenuItem>
    </>
  )
}

/** One label/value row in the ticket details list. */
function DetailRow({
  label,
  hint,
  stacked,
  children,
}: {
  label: ReactNode
  hint?: string
  stacked?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'gap-2 px-3 py-1',
        stacked ? 'flex flex-col gap-1' : 'grid grid-cols-[minmax(0,5.25rem)_minmax(0,1fr)] items-center',
      )}
    >
      <span className="truncate text-2xs text-text-muted" title={hint ?? (typeof label === 'string' ? label : undefined)}>
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/**
 * The conversation's ticket once an action tag is filed: stage stepper,
 * project, and the flow's custom fields. Filing and replacing the action tag
 * happen in the Hashtags picker (at most one action tag per conversation).
 */
export function ThreadCategory({ signalId, version }: Props) {
  const { t } = useTranslation('nav')
  const isAdmin = useIsAdmin()
  const collect = useCollectStageFields()
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setTicket(await getTicket(signalId).catch(() => null))
  }, [signalId])

  useEffect(() => {
    void load()
  }, [load, version])

  const run = async (fn: () => Promise<Ticket | null>, fallback: string) => {
    setBusy(true)
    try {
      setTicket(await fn())
    } catch (err) {
      toast.error(formatApiErrorMessage(err, fallback))
      await load()
    } finally {
      setBusy(false)
    }
  }

  const patch = (body: Parameters<typeof patchTicket>[1], fallback: string) =>
    run(() => patchTicket(signalId, body), fallback)

  const moveTo = (stageKey: string) => {
    const current = ticket
    const stage = current?.stages.find((row) => row.key === stageKey)
    if (!current || !stage) return
    void run(async () => {
      const result = await moveTicketToStage({
        signalId,
        stage,
        values: current.fields,
        collect,
        ticketName: current.name,
      })
      if (result.cancelled) return current
      return (await getTicket(signalId).catch(() => current)) ?? current
    }, t('tickets.updateError'))
  }

  if (!ticket) return null

  const proposed = ticket.status === 'proposed'
  const awaitingVerify = ticket.status === 'waiting' && !ticket.stage_key
  const choices = ticket.project_choices ?? []
  const projectName = ticket.project_id
    ? (choices.find((choice) => choice.id === ticket.project_id)?.name ?? t('tickets.project'))
    : t('tickets.noProject')
  const defs = ticket.field_defs ?? []
  const values = ticket.fields ?? {}
  const defKeys = new Set(defs.map((field) => field.key))
  const orphans = Object.entries(values).filter(([key, value]) => !defKeys.has(key) && String(value).trim())
  const stageIndex = ticket.stages.findIndex((stage) => stage.key === ticket.stage_key)
  const live = !proposed && ticket.status !== 'done' && ticket.status !== 'closed'

  const flowLink = ticket.workstream_id ? (
    <Link
      to={workstreamPath(ticket.workstream_id)}
      className="group inline-flex min-w-0 items-center gap-0.5 text-sm font-semibold text-text-heading hover:text-accent"
      title={t('tickets.openFlow')}
    >
      <Hashtag name={ticket.name} category />
      <ArrowUpRight size={12} className="shrink-0 text-text-muted opacity-0 transition group-hover:opacity-100" />
    </Link>
  ) : (
    <Hashtag name={ticket.name} category className="text-sm font-semibold text-text-heading" />
  )

  return (
    <section className="space-y-1.5" data-testid="thread-ticket">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-text-muted">{t('tickets.title')}</p>
        {ticket.filed_at && !proposed ? (
          <span className="text-2xs text-text-muted" title={new Date(ticket.filed_at).toLocaleString()}>
            {t('tickets.filedAgo', { time: timeAgo(ticket.filed_at, t) })}
          </span>
        ) : null}
      </div>

      <div
        className={cn(
          'overflow-hidden rounded-xl border bg-bg-elevated/40',
          proposed ? 'border-status-warning/50' : live ? 'border-accent/35' : 'border-border/60',
        )}
      >
        {proposed ? (
          <div className="space-y-2 bg-status-warning/5 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-xs text-text-secondary">
              <Sparkles size={12} className="text-status-warning" aria-hidden />
              {t('tickets.looksLike')}
              <Hashtag name={ticket.name} category className="font-semibold text-text-heading" />
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {choices.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" size="sm" disabled={busy} className="h-7 gap-1 px-2.5 text-xs">
                      {t('tickets.confirmOn')}
                      <ChevronDown size={11} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <ProjectItems
                      choices={choices}
                      disabled={busy}
                      onPick={(projectId) =>
                        void patch({ status: 'open', project_id: projectId }, t('tickets.acceptError'))
                      }
                      t={t}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => void patch({ status: 'open' }, t('tickets.acceptError'))}
                >
                  {t('tickets.confirm')}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                className="h-7 px-2.5 text-xs"
                onClick={() => void patch({ status: 'dismissed' }, t('tickets.acceptError'))}
              >
                {t('tickets.dismiss')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-2 px-3 pb-2.5 pt-2.5">
              <div className="flex items-center justify-between gap-2">
                {flowLink}
                {awaitingVerify ? null : (
                  <span className="inline-flex shrink-0 items-center gap-1 text-2xs font-medium text-text-secondary">
                    {ticket.stage ? <StageProgressIcon kind={ticket.stage.kind} size={12} /> : null}
                    {ticket.stage ? stageLabel(ticket.stage, t) : t(`tickets.status.${ticket.status}`)}
                  </span>
                )}
              </div>

              {awaitingVerify ? (
                <p className="text-xs text-text-muted">{t('tickets.awaitingVerify')}</p>
              ) : ticket.stages.length > 0 ? (
                <div>
                  <div className="flex gap-1" role="group" aria-label={t('tickets.stage')}>
                    {ticket.stages.map((stage, index) => {
                      const reached = stageIndex >= 0 && index <= stageIndex
                      const current = index === stageIndex
                      return (
                        <button
                          key={stage.key}
                          type="button"
                          disabled={busy || current}
                          onClick={() => moveTo(stage.key)}
                          title={current ? stageLabel(stage, t) : t('tickets.moveTo', { stage: stageLabel(stage, t) })}
                          aria-label={t('tickets.moveTo', { stage: stageLabel(stage, t) })}
                          aria-current={current ? 'step' : undefined}
                          className="group/seg flex-1 py-1 disabled:cursor-default"
                        >
                          <span
                            className={cn(
                              'block h-1.5 rounded-full transition',
                              reached ? SEGMENT_KIND[stage.kind] : 'bg-border/70 group-hover/seg:bg-border',
                              current && 'ring-2 ring-accent/30 ring-offset-1 ring-offset-bg-surface',
                            )}
                          />
                        </button>
                      )
                    })}
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-2xs text-text-muted">
                    <span>
                      {stageIndex >= 0
                        ? t('tickets.stageOf', { index: stageIndex + 1, count: ticket.stages.length })
                        : t(`tickets.status.${ticket.status}`)}
                    </span>
                    {ticket.checkup?.next_at ? (
                      <Link
                        to={`/agenda?view=list&date=${ticket.checkup.next_at.slice(0, 10)}`}
                        className="inline-flex items-center gap-1 hover:text-text-primary"
                        title={checkupLabel(ticket.checkup.every_minutes, t)}
                      >
                        <ClipboardCheck size={11} aria-hidden />
                        {Date.parse(ticket.checkup.next_at) <= Date.now()
                          ? t('tickets.checkupDue')
                          : t('tickets.checkupNext', { when: relativeMoment(Date.parse(ticket.checkup.next_at), Date.now(), t) })}
                      </Link>
                    ) : null}
                  </p>
                </div>
              ) : null}
            </div>

            <div className="border-t border-border/40 py-1.5">
              <DetailRow label={t('tickets.project')}>
                {choices.length > 0 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={t('tickets.project')}
                        className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-transparent px-1.5 text-xs text-text-heading transition hover:border-border/60 hover:bg-bg-input/40"
                      >
                        <FolderKanban size={12} className="shrink-0 text-text-muted" />
                        <span className="truncate">{projectName}</span>
                        <ChevronDown size={11} className="shrink-0 text-text-muted" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <ProjectItems
                        choices={choices}
                        current={ticket.project_id}
                        disabled={busy}
                        onPick={(projectId) => void patch({ project_id: projectId }, t('tickets.updateError'))}
                        t={t}
                      />
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <span className="px-1.5 text-xs text-text-muted">{t('tickets.noProject')}</span>
                )}
                {ticket.project_id ? (
                  <Link
                    to={`/projects/${ticket.project_id}`}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition hover:bg-bg-input/40 hover:text-accent"
                    aria-label={t('tickets.openProject')}
                    title={t('tickets.openProject')}
                  >
                    <ArrowUpRight size={12} />
                  </Link>
                ) : null}
              </DetailRow>

              {defs.map((field) => (
                <FieldRow
                  key={field.key}
                  field={field}
                  value={values[field.key] ?? ''}
                  disabled={busy}
                  t={t}
                  onSave={(next) => void patch({ fields: { [field.key]: next } }, t('tickets.updateError'))}
                />
              ))}

              {orphans.map(([key, value]) => (
                <DetailRow key={key} label={key} hint={t('tickets.removedField')}>
                  <span className="block truncate px-1.5 text-xs text-text-secondary" title={value}>
                    {value}
                  </span>
                </DetailRow>
              ))}
            </div>

            {defs.length === 0 && isAdmin && ticket.workstream_id ? (
              <Link
                to={`${workstreamPath(ticket.workstream_id)}?edit=1`}
                className="flex items-center gap-1.5 border-t border-border/40 px-3 py-2 text-2xs text-text-muted transition hover:bg-bg-muted/40 hover:text-accent"
              >
                <Plus size={11} aria-hidden />
                {t('tickets.addFields')}
              </Link>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}

/** A custom field: reads like a value, edits in place, saves on blur or pick. */
function FieldRow({
  field,
  value,
  disabled,
  t,
  onSave,
}: {
  field: TicketStageField
  value: string
  disabled: boolean
  t: TFn
  onSave: (next: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const missing = field.required && !draft.trim()

  const commit = (next: string) => {
    if (next.trim() === value.trim()) return
    onSave(next)
  }

  const label = (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="truncate">{field.name}</span>
      {field.required ? (
        <span className={cn('shrink-0', missing ? 'text-status-warning' : 'text-text-muted/60')} aria-hidden>
          *
        </span>
      ) : null}
    </span>
  )

  return (
    <DetailRow
      label={label}
      hint={field.required ? `${field.name} (${t('tickets.required')})` : field.name}
      stacked={field.type === 'textarea'}
    >
      <TicketFieldControl
        field={field}
        value={draft}
        disabled={field.type === 'enum' && disabled}
        placeholder={
          field.type === 'enum'
            ? t('tickets.pickValue')
            : field.type === 'textarea'
              ? t('tickets.addValue')
              : t('tickets.emptyValue')
        }
        commitOnEnter
        className={
          field.type === 'enum'
            ? cn(
                'h-7 border-transparent bg-transparent px-1.5 text-xs shadow-none hover:border-border/60 hover:bg-bg-input/40',
                !draft && 'text-text-muted',
              )
            : field.type === 'textarea'
              ? 'min-h-[2.75rem] w-full resize-y rounded-md border border-border/50 bg-bg-input/30 px-2 py-1.5 text-xs text-text-heading outline-none transition placeholder:text-text-muted/70 focus:border-accent focus:bg-bg-input'
              : cn(INLINE_INPUT, field.type === 'number' && 'tabular-nums')
        }
        onChange={(next) => {
          setDraft(next)
          if (field.type === 'enum') commit(next)
        }}
        onBlur={field.type === 'enum' ? undefined : commit}
      />
    </DetailRow>
  )
}
