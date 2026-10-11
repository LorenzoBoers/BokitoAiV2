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
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../ui/select'
import { AgentSelect } from '../ui/AgentSelect'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { useAuth } from '../../context/AuthContext'
import { useAgents } from '../../hooks/useAgents'
import { useMembers } from '../../hooks/useMembers'
import { useTeams } from '../../hooks/useTeams'
import type { InboxThread, ScheduleRecipient } from '../../lib/inbox-api'
import { createScheduledThread, setThreadSchedule } from '../../lib/signals-api'
import {
  DEFAULT_REPEAT,
  defaultMoment,
  fromLocalInput,
  parseServerTime,
  repeatFromSchedule,
  repeatToSchedule,
  toLocalInput,
  weekdayName,
  type RepeatChoice,
  type RepeatPreset,
} from '../../lib/thread-schedule'

/** Defaults for a new agenda item or recurring task. */
export type PlanSeed = {
  title?: string
  at?: Date | null
  /** Start in repeat mode with this choice. */
  repeat?: RepeatChoice | null
  /** Agent id, or `lead` for the workspace lead agent. */
  agentId?: string | null
  instructions?: string
  recipient?: ScheduleRecipient | null
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

const PRESETS: RepeatPreset[] = ['weekdays', 'daily', 'weekly', 'hourly', 'custom']
const NO_AGENT = '__none__'

function recipientValue(recipient: ScheduleRecipient | null | undefined): string {
  return recipient ? `${recipient.kind}:${recipient.id}` : ''
}

function parseRecipient(value: string): ScheduleRecipient | null {
  const [kind, id] = value.split(':')
  if ((kind === 'user' || kind === 'team') && id) return { kind, id }
  return null
}

/**
 * Give a thread a date (agenda item) or a repeat (recurring task), optionally
 * with an agent that writes into the thread when the moment comes.
 */
export default function PlanDialog({ open, onOpenChange, thread = null, seed, onSaved }: Props) {
  const { t, i18n } = useTranslation('communication')
  const { token, user } = useAuth()
  const { members } = useMembers()
  const { agents } = useAgents()
  const { teams } = useTeams()
  const [title, setTitle] = useState('')
  const [mode, setMode] = useState<Mode>('once')
  const [at, setAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [repeat, setRepeat] = useState<RepeatChoice>(DEFAULT_REPEAT)
  const [recipient, setRecipient] = useState('')
  const [agentId, setAgentId] = useState(NO_AGENT)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  const isNew = thread == null
  const showTitle = isNew || thread?.source === 'schedule'
  const meValue = user?.uuid ? `user:${user.uuid}` : ''

  useEffect(() => {
    if (!open) return
    const rule = thread?.schedule ?? null
    const owner = thread?.owner
    const ownerRecipient: ScheduleRecipient | null =
      owner?.kind === 'user' && owner.userId
        ? { kind: 'user', id: owner.userId }
        : owner?.kind === 'team' && owner.teamId
          ? { kind: 'team', id: owner.teamId }
          : null
    setTitle(thread ? thread.emailSubject : (seed?.title ?? ''))
    const start = parseServerTime(thread?.nextAt) ?? seed?.at ?? defaultMoment()
    setAt(toLocalInput(start))
    const end = parseServerTime(thread?.endsAt)
    setEndsAt(end ? toLocalInput(end) : '')
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
    setRecipient(recipientValue(rule?.recipient ?? seed?.recipient ?? ownerRecipient) || meValue)
    setAgentId(rule?.agentId ?? (seed?.agentId && seed.agentId !== 'lead' ? seed.agentId : NO_AGENT))
    setText(rule ? rule.instructions : (thread?.scheduleDetails.note ?? seed?.instructions ?? ''))
  }, [open, thread, seed, meValue])

  // `lead` resolves once the agent list is in.
  useEffect(() => {
    if (!open || seed?.agentId !== 'lead' || thread || agentId !== NO_AGENT || agents.length === 0) return
    const lead = agents.find((agent) => agent.is_lead) ?? agents[0]
    if (lead) setAgentId(lead.id)
    // Only on first load of the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agents])

  const hasAgent = agentId !== NO_AGENT
  const people = useMemo(() => members.filter((m) => m.uuid), [members])
  const atIso = fromLocalInput(at)
  const endIso = mode === 'once' ? fromLocalInput(endsAt) : null
  const endBeforeStart = Boolean(atIso && endIso && endIso < atIso)
  const schedule = mode === 'repeat' ? repeatToSchedule(repeat) : null
  const canSave =
    !saving &&
    (!showTitle || title.trim().length > 0) &&
    (mode === 'once' ? Boolean(atIso) && !endBeforeStart : Boolean(schedule?.cron || schedule?.everyMinutes)) &&
    (!hasAgent || text.trim().length > 0)

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
        agentId: hasAgent ? agentId : null,
        instructions: hasAgent ? text.trim() : null,
        note: hasAgent ? undefined : text.trim(),
        recipient: parseRecipient(recipient),
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

          <div className="space-y-1.5">
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
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="plan-at">{t('plan.start')}</Label>
                <Input id="plan-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
              </div>
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
            <Label>{t('plan.forWhom')}</Label>
            <Select value={recipient || undefined} onValueChange={setRecipient}>
              <SelectTrigger aria-label={t('plan.forWhom')}>
                <SelectValue placeholder={t('plan.forWhomPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {meValue ? <SelectItem value={meValue}>{t('plan.me')}</SelectItem> : null}
                <SelectGroup>
                  <SelectLabel>{t('plan.people')}</SelectLabel>
                  {people
                    .filter((m) => `user:${m.uuid}` !== meValue)
                    .map((m) => (
                      <SelectItem key={m.uuid} value={`user:${m.uuid}`}>
                        {m.name || m.email}
                      </SelectItem>
                    ))}
                </SelectGroup>
                {teams.length > 0 ? (
                  <SelectGroup>
                    <SelectLabel>{t('plan.teams')}</SelectLabel>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={`team:${team.id}`}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ) : null}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{t('plan.agent')}</Label>
            <AgentSelect
              agents={agents}
              value={agentId}
              onValueChange={setAgentId}
              emptyOption={{ value: NO_AGENT, label: t('plan.noAgent') }}
              aria-label={t('plan.agent')}
            />
            <p className="text-xs text-text-muted">{hasAgent ? t('plan.agentHint') : t('plan.noAgentHint')}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plan-text">{hasAgent ? t('plan.instructions') : t('plan.note')}</Label>
            <Textarea
              id="plan-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={hasAgent ? 5 : 3}
              placeholder={hasAgent ? t('plan.instructionsPlaceholder') : t('plan.notePlaceholder')}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('plan.cancel')}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={!canSave}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : t('plan.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
