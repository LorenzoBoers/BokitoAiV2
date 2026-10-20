import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { SegmentedControl } from '../ui/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Switch } from '../ui/switch'
import { FilterChip, FilterChipRow } from '../ui/filter-chip'
import { ChoiceSelect, type ChoiceGroup } from '../ui/ChoiceSelect'
import { TextLink } from '../ui/text-link'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { useAuth } from '../../context/AuthContext'
import { useAgents } from '../../hooks/useAgents'
import { useMembers } from '../../hooks/useMembers'
import { useTeams } from '../../hooks/useTeams'
import type { InboxThread } from '../../lib/inbox-api'
import {
  clearThreadSchedule,
  createScheduledThread,
  listSignalAssignees,
  runThreadSchedule,
  setThreadSchedule,
  setThreadScheduleEnabled,
  type AssigneeCandidates,
  type ScheduleOwner,
} from '../../lib/signals-api'
import {
  DEFAULT_REPEAT,
  DEFAULT_SURFACE_BEFORE_MINUTES,
  QUICK_MOMENTS,
  SURFACE_BEFORE_MINUTES,
  fromLocalInput,
  parseServerTime,
  quickMomentDate,
  repeatFromSchedule,
  repeatToSchedule,
  scheduleLongLabel,
  surfaceBeforeFor,
  toLocalInput,
  weekdayName,
  type QuickMoment,
  type RepeatChoice,
  type RepeatPreset,
} from '../../lib/thread-schedule'

/** Defaults for a new agenda item or recurring task. */
export type PlanSeed = {
  title?: string
  at?: Date | null
  /** Start in repeat mode with this choice. */
  repeat?: RepeatChoice | null
  /** Who it is for; `lead` is the workspace lead agent. */
  owner?: ScheduleOwner | 'lead' | null
  instructions?: string
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Thread to plan; null or absent starts a new thread. */
  thread?: InboxThread | null
  seed?: PlanSeed
  onSaved?: (thread: InboxThread | null) => void
}

type Mode = 'once' | 'repeat'
type Moment = QuickMoment | 'custom'

const PRESETS: RepeatPreset[] = ['weekdays', 'daily', 'weekly', 'hourly', 'custom']

function ownerValue(owner: ScheduleOwner | null | undefined): string {
  return owner ? `${owner.kind}:${owner.id}` : ''
}

function parseOwner(value: string): ScheduleOwner | null {
  const [kind, id] = value.split(':')
  if ((kind === 'user' || kind === 'agent' || kind === 'team') && id) return { kind, id }
  return null
}

function threadOwner(thread: InboxThread | null): ScheduleOwner | null {
  const owner = thread?.owner
  if (owner?.kind === 'user' && owner.userId) return { kind: 'user', id: owner.userId }
  if (owner?.kind === 'agent' && owner.agentId) return { kind: 'agent', id: owner.agentId }
  if (owner?.kind === 'team' && owner.teamId) return { kind: 'team', id: owner.teamId }
  return null
}

/**
 * Give a thread a date (agenda item), a repeat (recurring task), or snooze it.
 * The conversation owner is who the moment is for: a person or team gets it
 * back unread, an agent works in the thread with the task.
 */
export default function PlanDialog({ open, onOpenChange, thread = null, seed, onSaved }: Props) {
  const { t, i18n } = useTranslation('communication')
  const { token, user } = useAuth()
  const { members } = useMembers()
  const { agents } = useAgents()
  const { teams } = useTeams()
  const [title, setTitle] = useState('')
  const [mode, setMode] = useState<Mode>('once')
  const [moment, setMoment] = useState<Moment>('tomorrow')
  const [at, setAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [showEnd, setShowEnd] = useState(false)
  const [repeat, setRepeat] = useState<RepeatChoice>(DEFAULT_REPEAT)
  const [owner, setOwner] = useState('')
  const [hide, setHide] = useState(true)
  const [surfaceBefore, setSurfaceBefore] = useState(DEFAULT_SURFACE_BEFORE_MINUTES)
  const [notify, setNotify] = useState(true)
  const [text, setText] = useState('')
  const [candidates, setCandidates] = useState<AssigneeCandidates | null>(null)
  const [saving, setSaving] = useState(false)
  const [acting, setActing] = useState<'run' | 'toggle' | 'clear' | null>(null)

  const isNew = thread == null
  const showTitle = isNew || thread?.source === 'schedule'
  const meValue = user?.uuid ? `user:${user.uuid}` : ''

  useEffect(() => {
    if (!open) return
    const rule = thread?.schedule ?? null
    const planned = Boolean(thread?.nextAt || rule)
    setTitle(thread ? thread.emailSubject : (seed?.title ?? ''))
    const start = parseServerTime(thread?.nextAt) ?? seed?.at ?? null
    setMoment(start ? 'custom' : 'tomorrow')
    setAt(toLocalInput(start ?? quickMomentDate('tomorrow')))
    const end = parseServerTime(thread?.endsAt)
    setEndsAt(end ? toLocalInput(end) : '')
    setShowEnd(Boolean(end))
    if (rule?.repeat) {
      setMode('repeat')
      setRepeat(repeatFromSchedule(rule.repeat))
    } else if (!thread && seed?.repeat) {
      setMode('repeat')
      setRepeat(seed.repeat)
    } else {
      setMode('once')
      setRepeat(DEFAULT_REPEAT)
    }
    const seeded = seed?.owner && seed.owner !== 'lead' ? seed.owner : null
    setOwner(ownerValue(planned ? threadOwner(thread) : seeded) || meValue)
    setHide(planned ? Boolean(thread?.hiddenUntil) : true)
    setSurfaceBefore(
      planned ? surfaceBeforeFor(thread?.nextAt, thread?.hiddenUntil) : DEFAULT_SURFACE_BEFORE_MINUTES,
    )
    setNotify(planned ? thread?.scheduleDetails.notify !== false : true)
    setText(rule?.instructions || thread?.scheduleDetails.note || seed?.instructions || '')
    setCandidates(null)
  }, [open, thread, seed, meValue])

  // `lead` resolves once the agent list is in.
  useEffect(() => {
    if (!open || seed?.owner !== 'lead' || thread || agents.length === 0) return
    const lead = agents.find((agent) => agent.is_lead) ?? agents[0]
    if (lead) setOwner(`agent:${lead.id}`)
    // Only on first load of the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agents])

  // An existing conversation can only go to people, agents and teams with access to its channel.
  useEffect(() => {
    if (!open || !token || !thread) return
    let cancelled = false
    listSignalAssignees(token, String(thread.id))
      .then((rows) => {
        if (!cancelled) setCandidates(rows)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, token, thread])

  const ownerGroups = useMemo<ChoiceGroup[]>(() => {
    const blocked = new Set<string>()
    if (candidates) {
      for (const p of candidates.people) if (!p.canHandle) blocked.add(`user:${p.uuid}`)
      for (const a of candidates.agents) if (!a.canHandle) blocked.add(`agent:${a.id}`)
      for (const team of candidates.teams) if (!team.canHandle) blocked.add(`team:${team.id}`)
    }
    const me = members.find((m) => `user:${m.uuid}` === meValue)
    const meName = me?.name || user?.name || user?.email || t('plan.me')
    return [
      {
        items: meValue
          ? [
              {
                value: meValue,
                label: t('plan.me'),
                kind: 'person' as const,
                person: { name: meName, email: me?.email ?? user?.email, avatarUrl: me?.avatarUrl },
              },
            ]
          : [],
      },
      {
        label: t('plan.people'),
        items: members
          .filter((m) => m.uuid && `user:${m.uuid}` !== meValue)
          .map((m) => ({
            value: `user:${m.uuid}`,
            label: m.name || m.email,
            kind: 'person' as const,
            person: { name: m.name || m.email, email: m.email, avatarUrl: m.avatarUrl },
            disabled: blocked.has(`user:${m.uuid}`),
          })),
      },
      {
        label: t('plan.agents'),
        items: agents.map((agent) => ({
          value: `agent:${agent.id}`,
          label: agent.name,
          kind: 'agent' as const,
          agent,
          disabled: blocked.has(`agent:${agent.id}`),
        })),
      },
      {
        label: t('plan.teams'),
        items: teams
          .filter((team) => !team.system)
          .map((team) => ({
            value: `team:${team.id}`,
            label: team.name,
            kind: 'team' as const,
            team,
            disabled: blocked.has(`team:${team.id}`),
          })),
      },
    ]
  }, [agents, candidates, members, meValue, t, teams, user])

  const ownerChoice = parseOwner(owner)
  const ownerIsAgent = ownerChoice?.kind === 'agent'
  const ownerLabel = useMemo(() => {
    for (const group of ownerGroups) {
      const hit = group.items.find((item) => item.value === owner)
      if (hit) return owner === meValue ? t('plan.you') : hit.label
    }
    return ''
  }, [owner, ownerGroups, meValue, t])

  const pickMoment = (next: Moment) => {
    setMoment(next)
    if (next !== 'custom') setAt(toLocalInput(quickMomentDate(next)))
  }

  const atIso = fromLocalInput(at)
  const endIso = mode === 'once' && showEnd ? fromLocalInput(endsAt) : null
  const endBeforeStart = Boolean(atIso && endIso && endIso < atIso)
  const schedule = mode === 'repeat' ? repeatToSchedule(repeat) : null
  const hiding = mode === 'once' && hide
  const canSave =
    !saving &&
    (!showTitle || title.trim().length > 0) &&
    (mode === 'once' ? Boolean(atIso) && !endBeforeStart : Boolean(schedule?.cron || schedule?.everyMinutes)) &&
    (!ownerIsAgent || text.trim().length > 0)

  const summary = useMemo(() => {
    if (!ownerLabel) return ''
    if (mode === 'repeat') {
      return ownerIsAgent
        ? t('plan.summary.repeatAgent', { who: ownerLabel })
        : t('plan.summary.repeat', { who: ownerLabel })
    }
    if (!atIso) return ''
    const when = scheduleLongLabel(atIso, i18n.language)
    if (ownerIsAgent) return t('plan.summary.agent', { when, who: ownerLabel })
    if (hiding && surfaceBefore > 0) {
      return t('plan.summary.hiddenEarly', { when, who: ownerLabel, lead: t(`plan.surface.${surfaceBefore}`) })
    }
    return hiding ? t('plan.summary.hidden', { when, who: ownerLabel }) : t('plan.summary.visible', { when, who: ownerLabel })
  }, [atIso, hiding, i18n.language, mode, ownerIsAgent, ownerLabel, surfaceBefore, t])

  const save = async () => {
    if (!token || !canSave) return
    setSaving(true)
    try {
      const input = {
        title: showTitle ? title.trim() : undefined,
        at: mode === 'once' ? atIso : null,
        endsAt: endIso,
        cron: schedule?.cron ?? null,
        everyMinutes: schedule?.everyMinutes ?? null,
        instructions: ownerIsAgent ? text.trim() : null,
        note: ownerIsAgent ? undefined : text.trim(),
        owner: ownerChoice,
        hide: hiding,
        surfaceBeforeMinutes: hiding ? surfaceBefore : 0,
        notify,
      }
      const saved = thread
        ? await setThreadSchedule(token, String(thread.id), input)
        : await createScheduledThread(token, input)
      toast.success(t('plan.saved'))
      onOpenChange(false)
      onSaved?.(saved)
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('plan.saveError')))
    } finally {
      setSaving(false)
    }
  }

  const runScheduleAction = async (kind: 'run' | 'toggle' | 'clear') => {
    if (!token || !thread || acting) return
    setActing(kind)
    try {
      if (kind === 'run') {
        await runThreadSchedule(token, String(thread.id))
        toast.success(t('schedule.runStarted'))
        onOpenChange(false)
        onSaved?.(null)
      } else if (kind === 'toggle' && thread.schedule) {
        const saved = await setThreadScheduleEnabled(token, String(thread.id), !thread.schedule.enabled)
        onSaved?.(saved)
      } else if (kind === 'clear') {
        const saved = await clearThreadSchedule(token, String(thread.id))
        toast.success(t('schedule.cleared'))
        onOpenChange(false)
        onSaved?.(saved)
      }
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('schedule.actionError')))
    } finally {
      setActing(null)
    }
  }

  const hasDate = Boolean(thread?.nextAt || thread?.schedule)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? t('plan.newTitle') : t('plan.title')}</DialogTitle>
          <DialogDescription>{t('plan.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {showTitle ? (
            <div className="space-y-1.5">
              <Label htmlFor="plan-title">{t('plan.name')}</Label>
              <Input
                id="plan-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('plan.namePlaceholder')}
                autoFocus
              />
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <Label>{t('plan.when')}</Label>
            <SegmentedControl<Mode>
              value={mode}
              onChange={setMode}
              size="sm"
              aria-label={t('plan.when')}
              options={[
                { value: 'once', label: t('plan.once') },
                { value: 'repeat', label: t('plan.repeat') },
              ]}
            />
          </div>

          {mode === 'once' ? (
            <div className="space-y-2">
              <FilterChipRow role="group" aria-label={t('plan.when')}>
                {QUICK_MOMENTS.map((kind) => (
                  <FilterChip key={kind} active={moment === kind} onClick={() => pickMoment(kind)}>
                    {t(`plan.quick.${kind}`)}
                  </FilterChip>
                ))}
                <FilterChip active={moment === 'custom'} onClick={() => pickMoment('custom')}>
                  {t('plan.quick.custom')}
                </FilterChip>
              </FilterChipRow>
              {moment === 'custom' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="plan-at">{t('plan.start')}</Label>
                    <Input id="plan-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
                  </div>
                  {showEnd ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="plan-end">{t('plan.end')}</Label>
                      <Input
                        id="plan-end"
                        type="datetime-local"
                        value={endsAt}
                        min={at || undefined}
                        onChange={(e) => setEndsAt(e.target.value)}
                      />
                      {endBeforeStart ? <p className="text-xs text-status-error">{t('plan.endBeforeStart')}</p> : null}
                    </div>
                  ) : (
                    <div className="flex items-end pb-2">
                      <TextLink type="button" onClick={() => setShowEnd(true)} className="text-xs">
                        {t('plan.addEnd')}
                      </TextLink>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-text-muted">{scheduleLongLabel(atIso, i18n.language)}</p>
              )}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t('plan.repeatEvery')}</Label>
                <Select value={repeat.preset} onValueChange={(v) => setRepeat({ ...repeat, preset: v as RepeatPreset })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRESETS.map((preset) => (
                      <SelectItem key={preset} value={preset}>
                        {t(`plan.presets.${preset}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {repeat.preset === 'custom' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="plan-cron">{t('plan.cron')}</Label>
                  <Input
                    id="plan-cron"
                    value={repeat.cron}
                    onChange={(e) => setRepeat({ ...repeat, cron: e.target.value })}
                    placeholder="0 7 * * 1-5"
                  />
                  <p className="text-xs text-text-muted">{t('plan.cronHint')}</p>
                </div>
              ) : repeat.preset === 'hourly' ? null : (
                <div className="flex gap-2">
                  {repeat.preset === 'weekly' ? (
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Label>{t('plan.day')}</Label>
                      <Select
                        value={String(repeat.weekday)}
                        onValueChange={(v) => setRepeat({ ...repeat, weekday: Number(v) })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                            <SelectItem key={day} value={String(day)}>
                              {weekdayName(day, i18n.language)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  <div className="w-28 shrink-0 space-y-1.5">
                    <Label htmlFor="plan-time">{t('plan.time')}</Label>
                    <Input
                      id="plan-time"
                      type="time"
                      value={repeat.time}
                      onChange={(e) => setRepeat({ ...repeat, time: e.target.value || '09:00' })}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="plan-owner">{t('plan.forWhom')}</Label>
            <ChoiceSelect
              id="plan-owner"
              aria-label={t('plan.forWhom')}
              value={owner}
              onValueChange={setOwner}
              placeholder={t('plan.forWhomPlaceholder')}
              groups={ownerGroups}
              triggerClassName="h-9"
            />
            <p className="text-xs text-text-muted">{ownerIsAgent ? t('plan.agentHint') : t('plan.personHint')}</p>
          </div>

          {mode === 'once' ? (
            <div className="space-y-2 rounded-md border border-border/60 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Label htmlFor="plan-hide">{t('plan.hide')}</Label>
                  <p className="text-xs text-text-muted">{t('plan.hideHint')}</p>
                </div>
                <Switch id="plan-hide" checked={hide} onCheckedChange={setHide} />
              </div>
              {hide ? (
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-text-secondary">{t('plan.surfaceLabel')}</Label>
                  <Select value={String(surfaceBefore)} onValueChange={(v) => setSurfaceBefore(Number(v))}>
                    <SelectTrigger className="h-8 w-44 text-xs" aria-label={t('plan.surfaceLabel')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SURFACE_BEFORE_MINUTES.map((minutes) => (
                        <SelectItem key={minutes} value={String(minutes)}>
                          {t(`plan.surface.${minutes}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {!ownerIsAgent ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Label htmlFor="plan-notify">{t('plan.notify')}</Label>
                    <p className="text-xs text-text-muted">{t('plan.notifyHint')}</p>
                  </div>
                  <Switch id="plan-notify" checked={notify} onCheckedChange={setNotify} />
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="plan-text">{ownerIsAgent ? t('plan.instructions') : t('plan.note')}</Label>
            <Textarea
              id="plan-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={ownerIsAgent ? 4 : 2}
              placeholder={ownerIsAgent ? t('plan.instructionsPlaceholder') : t('plan.notePlaceholder')}
            />
          </div>

          {summary ? <p className="text-sm text-text-secondary">{summary}</p> : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {hasDate && token && thread ? (
            <div className="flex flex-wrap gap-2">
              {thread.schedule?.agentId ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={saving || acting != null}
                  onClick={() => void runScheduleAction('run')}
                >
                  {t('schedule.runNow')}
                </Button>
              ) : null}
              {thread.schedule?.repeat ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={saving || acting != null}
                  onClick={() => void runScheduleAction('toggle')}
                >
                  {thread.schedule.enabled ? t('schedule.pause') : t('schedule.resume')}
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={saving || acting != null}
                onClick={() => void runScheduleAction('clear')}
              >
                {thread.schedule?.repeat ? t('schedule.stop') : t('schedule.clear')}
              </Button>
            </div>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={saving || acting != null}>
              {t('plan.cancel')}
            </Button>
            <Button type="button" onClick={() => void save()} disabled={!canSave || acting != null}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : t('plan.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
