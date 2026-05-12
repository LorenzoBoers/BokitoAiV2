import { Archive, ChevronDown, RefreshCw, X } from 'lucide-react'
import { useRef } from 'react'
import { cn } from '../../lib/utils'
import type { ThreadDetail as ThreadDetailType, PatchThreadInput } from '../../lib/inbox-api'
import { MessageTimelineItem, EventTimelineItem } from './TimelineItem'
import ReplyComposer from './ReplyComposer'
import AssigneeSelector from './AssigneeSelector'
import { Button } from '../ui/button'

type TimelineEntry =
  | { kind: 'message'; time: string; id: string; data: ThreadDetailType['messages'][number] }
  | { kind: 'event'; time: string; id: string; data: ThreadDetailType['events'][number] }

type Props = {
  detail: ThreadDetailType | null
  loading: boolean
  saving: boolean
  onPatch: (input: PatchThreadInput) => Promise<void>
  onReply: (bodyText: string, action: 'send' | 'send_and_close' | 'send_and_pending') => Promise<void>
  onNote: (bodyText: string) => Promise<void>
  onRefresh: () => void
}

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'pending', label: 'In behandeling' },
  { value: 'closed', label: 'Gesloten' },
  { value: 'spam', label: 'Spam' },
] as const

const STATUS_COLORS: Record<string, string> = {
  open: 'text-status-success',
  pending: 'text-status-warning',
  closed: 'text-text-muted',
  spam: 'text-status-error',
}

export default function ThreadDetail({ detail, loading, saving, onPatch, onReply, onNote, onRefresh }: Props) {
  const timelineEndRef = useRef<HTMLDivElement>(null)

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <RefreshCw size={18} className="animate-spin text-text-muted" />
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-text-muted">Selecteer een thread om te bekijken.</p>
      </div>
    )
  }

  const { thread, messages, events } = detail

  const timeline: TimelineEntry[] = [
    ...messages.map((m) => ({ kind: 'message' as const, time: m.receivedAt ?? m.createdAt, id: `m-${m.id}`, data: m })),
    ...events.filter((e) => e.eventType !== 'replied' && e.eventType !== 'note_added').map((e) => ({
      kind: 'event' as const,
      time: e.createdAt,
      id: `e-${e.id}`,
      data: e,
    })),
  ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border/50 bg-bg-surface shrink-0">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-text-heading truncate">{thread.emailSubject}</h2>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-text-secondary truncate">{thread.contactEmail}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <AssigneeSelector
            currentAssigneeId={thread.assignedToUserId}
            disabled={saving}
            onChange={(userId) => void onPatch({ assignedToUserId: userId ?? 0 })}
          />
          <div className="relative">
            <select
              value={thread.status}
              disabled={saving}
              onChange={(e) =>
                void onPatch({ status: e.target.value as typeof thread.status })
              }
              className={cn(
                'appearance-none rounded border border-border bg-bg-surface py-0.5 pl-2 pr-6 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-accent/50 disabled:opacity-50 cursor-pointer',
                STATUS_COLORS[thread.status] ?? 'text-text-primary',
              )}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <ChevronDown size={11} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted" />
          </div>
          {thread.status !== 'closed' ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void onPatch({ status: 'closed' })}
              disabled={saving}
              title="Sluiten"
            >
              <Archive size={14} />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void onPatch({ status: 'open' })}
              disabled={saving}
              title="Heropenen"
            >
              <X size={14} />
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-2">
        {timeline.map((entry) =>
          entry.kind === 'message' ? (
            <MessageTimelineItem key={entry.id} message={entry.data} />
          ) : (
            <EventTimelineItem key={entry.id} event={entry.data} />
          ),
        )}
        <div ref={timelineEndRef} />
      </div>

      <ReplyComposer
        onReply={onReply}
        onNote={onNote}
        saving={saving}
        disabled={thread.status === 'closed' || thread.status === 'spam'}
      />
    </div>
  )
}
