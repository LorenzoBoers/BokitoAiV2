import { ChevronDown, Sparkles } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import type { InboxThread, PatchThreadInput, ProposalItem } from '../../lib/inbox-api'
import { isInternalThread } from '../../lib/message-composer'
import { listCanvasesForThread, type ProjectCanvas } from '../../lib/project-canvas-api'
import { queueThreadTriage } from '../../lib/signals-api'
import { CanvasShowcaseCard } from './ProposalItemPreview'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { SettingRow } from '../ui/entity-row'
import { SectionLabel } from '../ui/section-label'
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
  /** Pause, resume, clear, or run-now changed the schedule. Null asks for a refetch. */
  onScheduleChanged?: (thread: InboxThread | null) => void
}

export const PRIORITY_META: Record<string, { labelKey: string; dot: string }> = {
  normal: { labelKey: 'priority.normal', dot: 'bg-text-muted/40' },
  high: { labelKey: 'priority.high', dot: 'bg-status-warning' },
  urgent: { labelKey: 'priority.urgent', dot: 'bg-status-error' },
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <SettingRow label={label} className="py-1.5">
      {children}
    </SettingRow>
  )
}

const VALUE_BUTTON = controlChipClass

function canvasItem(row: ProjectCanvas, cadence: string, writingLabel: string): ProposalItem {
  const empty = Boolean(row.empty)
  return {
    type: 'canvas',
    id: row.id,
    title: row.title,
    subtitle: empty
      ? writingLabel
      : [row.managing_agent?.name, cadence].filter(Boolean).join(' · '),
    path: empty
      ? null
      : row.project_id
        ? `/folders/${row.project_id}?tab=canvas&canvas=${row.id}`
        : `/cockpit/canvas?canvas=${row.id}`,
    signalId: row.signal_id ?? null,
    empty,
  }
}

/**
 * Everything noted on this one conversation: AI summary, priority,
 * date or repeat, re-read, category (or ticket) and tags.
 */
export function ConversationWorkSection({ thread, saving = false, onPatch, onPlan, onScheduleChanged }: Props) {
  const { t } = useTranslation(['communication', 'nav'])
  const { token } = useAuth()
  const [ticketBump, setTicketBump] = useState(0)
  const [rereading, setRereading] = useState(false)
  const [canvases, setCanvases] = useState<ProjectCanvas[]>([])
  const priority = thread.priority || 'normal'
  const priorityMeta = PRIORITY_META[priority] ?? PRIORITY_META.normal
  const internal = isInternalThread(thread)

  useEffect(() => {
    let cancel = false
    listCanvasesForThread(String(thread.id))
      .then((items) => {
        if (!cancel) setCanvases(items)
      })
      .catch(() => {
        if (!cancel) setCanvases([])
      })
    return () => {
      cancel = true
    }
  }, [thread.id])

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
    <div className="space-y-2 border-t border-border/40 px-4 py-3">
      <SectionLabel
        title={t('sidePanel.thisConversation', { defaultValue: 'This conversation' })}
        className="[&_.nav-folder]:h-5 [&_.nav-folder]:text-[10px] [&_.nav-folder]:font-normal"
        headerClassName="-mx-1"
        actions={
          !internal && token ? (
            <button
              type="button"
              onClick={() => void handleReread()}
              disabled={rereading || saving}
              className="inline-flex max-w-full items-center gap-0.5 px-0.5 text-[10px] font-medium text-text-muted hover:text-ai-ink hover:underline disabled:opacity-40"
              title={t('sidePanel.rereadHint', {
                defaultValue: 'Wake channel agent to review this conversation again',
              })}
            >
              <Sparkles size={10} className={rereading ? 'animate-pulse' : undefined} aria-hidden />
              <span className="truncate">{t('sidePanel.reread')}</span>
            </button>
          ) : null
        }
      />

      {!internal && thread.aiSummary ? (
        <p
          className="rounded-md border border-border/50 bg-bg-elevated/50 px-2.5 py-2 text-xs leading-relaxed text-text-secondary"
          data-testid="thread-ai-summary"
        >
          {thread.aiSummary}
        </p>
      ) : null}

      {canvases.length > 0 ? (
        <div className="space-y-2" data-testid="thread-canvases">
          {canvases.map((row) => (
            <CanvasShowcaseCard
              key={row.id}
              compact
              item={canvasItem(
                row,
                t(`projects.canvas.cadence.${row.refresh_cadence || 'manual'}`, { ns: 'nav' }),
                t('projects.canvas.writing', { ns: 'nav' }),
              )}
            />
          ))}
        </div>
      ) : null}

      <div className="divide-y divide-border/40">
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
                      <span className={`h-1 w-1 rounded-full ${priorityMeta.dot}`} />
                      {t(priorityMeta.labelKey)}
                      <ChevronDown size={10} className="text-text-muted" />
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

        <ScheduleSection thread={thread} onPlan={onPlan} onChanged={onScheduleChanged} />

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
