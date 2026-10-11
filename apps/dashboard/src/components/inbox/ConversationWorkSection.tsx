import { ChevronDown, Sparkles } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import type { InboxThread, PatchThreadInput } from '../../lib/inbox-api'
import { isInternalThread } from '../../lib/message-composer'
import { queueThreadTriage } from '../../lib/signals-api'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { SettingRow } from '../ui/entity-row'
import { controlChipClass } from '../ui/select'
import { ScheduleSection } from './ScheduleSection'
import { ThreadCategory } from './ThreadCategory'
import { ThreadTags } from './ThreadTags'

type Props = {
  thread: InboxThread
  saving?: boolean
  onPatch?: (input: PatchThreadInput) => Promise<void>
  /** Opens the planner (date or repeat for this thread). */
  onPlan?: () => void
}

export const PRIORITY_META: Record<string, { labelKey: string; dot: string }> = {
  normal: { labelKey: 'priority.normal', dot: 'bg-text-muted/40' },
  high: { labelKey: 'priority.high', dot: 'bg-status-warning' },
  urgent: { labelKey: 'priority.urgent', dot: 'bg-status-error' },
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <SettingRow label={label}>{children}</SettingRow>
}

const VALUE_BUTTON = controlChipClass

/**
 * Everything noted on this one conversation: AI summary, priority,
 * date or repeat, re-read, category (or ticket) and tags.
 */
export function ConversationWorkSection({ thread, saving = false, onPatch, onPlan }: Props) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const [ticketBump, setTicketBump] = useState(0)
  const [rereading, setRereading] = useState(false)
  const priority = thread.priority || 'normal'
  const priorityMeta = PRIORITY_META[priority] ?? PRIORITY_META.normal
  const internal = isInternalThread(thread)

  async function handleReread() {
    if (!token || rereading) return
    setRereading(true)
    try {
      await queueThreadTriage(token, String(thread.id))
      toast.success(t('sidePanel.rereadQueued', { defaultValue: 'Agent will review this conversation again' }))
    } catch {
      toast.error(t('sidePanel.rereadFailed', { defaultValue: 'Could not start another review' }))
    } finally {
      setRereading(false)
    }
  }

  return (
    <div className="space-y-3 border-t border-border/40 px-4 py-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h2 className="text-xs font-semibold text-text-muted">
          {t('sidePanel.thisConversation', { defaultValue: 'This conversation' })}
        </h2>
        {!internal && token ? (
          <button
            type="button"
            onClick={() => void handleReread()}
            disabled={rereading || saving}
            className="inline-flex max-w-full items-center gap-1 text-xs font-medium text-ai-ink hover:underline disabled:opacity-40"
            title={t('sidePanel.rereadHint', {
              defaultValue: 'Ask the channel agent to review this conversation again',
            })}
          >
            <Sparkles size={12} className={rereading ? 'animate-pulse' : undefined} aria-hidden />
            <span className="truncate">{t('sidePanel.reread')}</span>
          </button>
        ) : null}
      </div>

      {!internal && thread.aiSummary ? (
        <p
          className="rounded-md border border-border/50 bg-bg-elevated/50 px-2.5 py-2 text-xs leading-relaxed text-text-secondary"
          data-testid="thread-ai-summary"
        >
          {thread.aiSummary}
        </p>
      ) : null}

      <div className="space-y-0.5">
        {internal ? null : (
          <>
            <Row label={t('sidePanel.priority', { defaultValue: 'Priority' })}>
              {onPatch ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={saving}
                      aria-label={t('threadChrome.setPriority')}
                      className={VALUE_BUTTON}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${priorityMeta.dot}`} />
                      {t(priorityMeta.labelKey)}
                      <ChevronDown size={11} className="text-text-muted" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-36">
                    {Object.entries(PRIORITY_META).map(([value, meta]) => (
                      <DropdownMenuItem
                        key={value}
                        className="gap-2 text-xs"
                        onSelect={() => void onPatch({ priority: value as PatchThreadInput['priority'] })}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                        {t(meta.labelKey)}
                        {value === priority ? (
                          <span className="ml-auto h-1.5 w-1.5 rounded-full bg-text-heading" />
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs text-text-heading">
                  <span className={`h-1.5 w-1.5 rounded-full ${priorityMeta.dot}`} />
                  {t(priorityMeta.labelKey)}
                </span>
              )}
            </Row>
          </>
        )}

        <ScheduleSection thread={thread} onPlan={onPlan} />

        <Row label={t('tags.title')}>
          <ThreadTags
            thread={thread}
            saving={saving}
            onPatch={onPatch}
            onTicketChanged={() => setTicketBump((n) => n + 1)}
          />
        </Row>
      </div>

      <ThreadCategory
        signalId={String(thread.id)}
        version={`${thread.ticket?.tagId ?? ''}|${thread.ticket?.status ?? ''}|${thread.ticket?.stage?.key ?? ''}|${thread.ticket?.projectId ?? ''}|${ticketBump}`}
      />
    </div>
  )
}
