import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { Switch } from '../ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import {
  createTrigger,
  deleteTrigger,
  updateTrigger,
  type Trigger,
  type TriggerKind,
} from '../../lib/orchestration-api'
import { WebhookTriggerPanel } from './WebhookTriggerPanel'

export type TargetOption = { id: string; name: string }

type TriggerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Existing trigger to edit, or null to create a new one. */
  trigger: Trigger | null
  agents: TargetOption[]
  workstreams: TargetOption[]
  /** Preselected moment for new items (from clicking a calendar day). */
  initialRunAt?: Date | null
  onSaved: () => void
}

const KIND_OPTIONS: Array<{ value: TriggerKind; label: string; hint: string }> = [
  { value: 'once', label: 'One-off task', hint: 'Wakes the agent once at the scheduled time, then completes.' },
  { value: 'event', label: 'Event', hint: 'Calendar item with a notification at the scheduled time. No agent run.' },
  { value: 'cron', label: 'Cron schedule', hint: 'Recurring wake on a cron expression (UTC).' },
  { value: 'interval', label: 'Interval', hint: 'Recurring wake every N minutes.' },
  { value: 'heartbeat', label: 'Heartbeat', hint: 'Recurring checklist wake; agent reports only when something needs attention.' },
  { value: 'webhook', label: 'Webhook', hint: 'Fires when an external system calls the webhook URL.' },
]

function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function dateToLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function TriggerDialog({
  open,
  onOpenChange,
  trigger,
  agents,
  workstreams,
  initialRunAt,
  onSaved,
}: TriggerDialogProps) {
  const editing = trigger != null
  const [name, setName] = useState('')
  const [kind, setKind] = useState<TriggerKind>('once')
  const [runAt, setRunAt] = useState('')
  const [cronExpr, setCronExpr] = useState('0 9 * * 1-5')
  const [intervalMinutes, setIntervalMinutes] = useState(60)
  const [target, setTarget] = useState<string>('none')
  const [instructions, setInstructions] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [savedWebhook, setSavedWebhook] = useState<Trigger | null>(null)
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (trigger) {
      setName(trigger.name)
      setKind(trigger.kind)
      setRunAt(toLocalInputValue(trigger.next_run_at ?? trigger.last_run_at))
      setCronExpr(trigger.cron_expr || '0 9 * * 1-5')
      setIntervalMinutes(trigger.interval_minutes || 60)
      setTarget(
        trigger.workstream_id
          ? `ws:${trigger.workstream_id}`
          : trigger.agent_id
            ? `agent:${trigger.agent_id}`
            : 'none',
      )
      setInstructions(trigger.instructions)
      setEnabled(trigger.enabled)
    } else {
      const base = initialRunAt ?? new Date(Date.now() + 60 * 60 * 1000)
      setName('')
      setKind('once')
      setRunAt(dateToLocalInputValue(base))
      setCronExpr('0 9 * * 1-5')
      setIntervalMinutes(60)
      setTarget(agents[0] ? `agent:${agents[0].id}` : workstreams[0] ? `ws:${workstreams[0].id}` : 'none')
      setInstructions('')
      setEnabled(true)
    }
    setSavedWebhook(null)
    setRevealedSecret(null)
  }, [open, trigger, initialRunAt, agents, workstreams])

  const kindHint = useMemo(() => KIND_OPTIONS.find((k) => k.value === kind)?.hint ?? '', [kind])
  const needsRunAt = kind === 'once' || kind === 'event'
  const needsTarget = kind !== 'event'

  const canSave =
    name.trim().length > 0 &&
    (!needsRunAt || runAt.length > 0) &&
    (kind !== 'cron' || cronExpr.trim().length > 0) &&
    (kind !== 'interval' || intervalMinutes > 0) &&
    (!needsTarget || target !== 'none')

  const save = async () => {
    setSaving(true)
    try {
      const agentId = target.startsWith('agent:') ? target.slice('agent:'.length) : undefined
      const workstreamId = target.startsWith('ws:') ? target.slice('ws:'.length) : undefined
      const runAtIso = needsRunAt && runAt ? new Date(runAt).toISOString() : undefined
      if (editing && trigger) {
        await updateTrigger(trigger.id, {
          name: name.trim(),
          kind,
          cron_expr: kind === 'cron' ? cronExpr.trim() : '',
          interval_minutes: kind === 'interval' || kind === 'heartbeat' ? intervalMinutes : 0,
          agent_id: agentId ?? null,
          workstream_id: workstreamId ?? null,
          instructions,
          enabled,
          ...(runAtIso ? { run_at: runAtIso } : {}),
        })
        toast.success('Saved')
        if (kind === 'webhook') {
          setSavedWebhook({
            ...trigger,
            name: name.trim(),
            kind,
            instructions,
            enabled,
            agent_id: agentId ?? null,
            workstream_id: workstreamId ?? null,
          })
          onSaved()
        } else {
          onOpenChange(false)
          onSaved()
        }
      } else {
        const created = await createTrigger({
          name: name.trim(),
          kind,
          cron_expr: kind === 'cron' ? cronExpr.trim() : undefined,
          interval_minutes: kind === 'interval' || kind === 'heartbeat' ? intervalMinutes : undefined,
          agent_id: agentId,
          workstream_id: workstreamId,
          instructions,
          enabled,
          run_at: runAtIso,
        })
        if (kind === 'webhook' && created.webhook_secret) {
          setSavedWebhook(created)
          setRevealedSecret(created.webhook_secret)
          toast.success('Webhook created. Copy the secret now — it is shown once.')
          onSaved()
        } else {
          toast.success('Scheduled')
          onOpenChange(false)
          onSaved()
        }
      }
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not save.'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!trigger) return
    setDeleting(true)
    try {
      await deleteTrigger(trigger.id)
      toast.success('Deleted')
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not delete.'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit schedule' : 'New schedule'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Adjust when this item runs and what it does.'
              : 'Plan an agent wake, a one-off task, or a calendar event.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="trigger-name">Name</Label>
            <Input
              id="trigger-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Morning briefing"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as TriggerKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {needsRunAt ? (
              <div className="space-y-1.5">
                <Label htmlFor="trigger-run-at">When</Label>
                <Input
                  id="trigger-run-at"
                  type="datetime-local"
                  value={runAt}
                  onChange={(e) => setRunAt(e.target.value)}
                />
              </div>
            ) : kind === 'cron' ? (
              <div className="space-y-1.5">
                <Label htmlFor="trigger-cron">Cron expression (UTC)</Label>
                <Input
                  id="trigger-cron"
                  value={cronExpr}
                  onChange={(e) => setCronExpr(e.target.value)}
                  placeholder="0 9 * * 1-5"
                />
              </div>
            ) : kind === 'interval' || kind === 'heartbeat' ? (
              <div className="space-y-1.5">
                <Label htmlFor="trigger-interval">Every (minutes)</Label>
                <Input
                  id="trigger-interval"
                  type="number"
                  min={1}
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Number(e.target.value) || 0)}
                />
              </div>
            ) : null}
          </div>

          <p className="text-xs text-text-muted">{kindHint}</p>

          {needsTarget ? (
            <div className="space-y-1.5">
              <Label>Target</Label>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick an agent or workstream" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={`agent:${a.id}`}>
                      Agent: {a.name}
                    </SelectItem>
                  ))}
                  {workstreams.map((w) => (
                    <SelectItem key={w.id} value={`ws:${w.id}`}>
                      Workstream: {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {agents.length === 0 && workstreams.length === 0 ? (
                <p className="text-xs text-status-error">Create an agent first — schedules need a target to run.</p>
              ) : target === 'none' ? (
                <p className="text-xs text-text-muted">Required for agent wakes and webhooks.</p>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="trigger-instructions">
              {kind === 'event' ? 'Description' : 'Instructions for the agent'}
            </Label>
            <Textarea
              id="trigger-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              placeholder={
                kind === 'event'
                  ? 'What is this event about?'
                  : 'What should the agent do when it wakes?'
              }
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2">
            <div>
              <p className="text-sm font-medium text-text-heading">Enabled</p>
              <p className="text-xs text-text-muted">Disabled items stay on the agenda but never fire.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {(kind === 'webhook' && (savedWebhook ?? (editing ? trigger : null))) ? (
            <WebhookTriggerPanel
              trigger={savedWebhook ?? trigger!}
              revealedSecret={revealedSecret}
              onSecretConsumed={() => setRevealedSecret(null)}
              onUpdated={onSaved}
            />
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {editing ? (
              <Button type="button" variant="ghost" className="text-status-error" disabled={deleting || saving} onClick={() => void remove()}>
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {savedWebhook ? 'Close' : 'Cancel'}
            </Button>
            <Button type="button" onClick={() => void save()} disabled={!canSave || saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? 'Save' : 'Schedule'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
