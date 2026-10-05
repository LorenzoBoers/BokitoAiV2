import { ChevronDown, ListPlus, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { InboxThread, PatchThreadInput } from '../../lib/inbox-api'
import { isInternalThread } from '../../lib/message-composer'
import { formatWakeTime } from '../../lib/snooze'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { ThreadCategory } from './ThreadCategory'
import { ThreadTags } from './ThreadTags'

type Props = {
  thread: InboxThread
  saving?: boolean
  onPatch?: (input: PatchThreadInput) => Promise<void>
  /** Opens the "look again" planner; absent on closed/spam threads. */
  onWhatsNext?: () => void
}

export const PRIORITY_META: Record<string, { labelKey: string; dot: string }> = {
  normal: { labelKey: 'priority.normal', dot: 'bg-text-muted/40' },
  high: { labelKey: 'priority.high', dot: 'bg-status-warning' },
  urgent: { labelKey: 'priority.urgent', dot: 'bg-status-error' },
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3">
      <span className="shrink-0 text-xs text-text-muted">{label}</span>
      <div className="flex min-w-0 items-center justify-end">{children}</div>
    </div>
  )
}

const VALUE_BUTTON =
  'inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border border-border/70 px-2 text-xs text-text-heading transition-colors hover:bg-bg-hover/70 disabled:opacity-40'

/**
 * Everything noted on this one conversation: priority, the planned
 * look-again moment, AI triage, its category (or ticket) and tags. Not Contact
 * identity (that is ContactPanel) and not a project folder.
 */
export function ConversationWorkSection({ thread, saving = false, onPatch, onWhatsNext }: Props) {
  const { t, i18n } = useTranslation('communication')
  const priority = thread.priority || 'normal'
  const priorityMeta = PRIORITY_META[priority] ?? PRIORITY_META.normal
  const triage = {
    category: thread.category,
    urgency: thread.urgency,
    certainty: thread.certainty,
    summary: thread.aiSummary,
  }
  const hasTriage = Boolean(triage.category) || triage.certainty != null
  const followUpWake = thread.followUpAt ? formatWakeTime(thread.followUpAt, t, i18n.language) : null
  // Agent and assistant threads carry a category only; priority, look-again and
  // triage belong to customer conversations.
  const internal = isInternalThread(thread)

  return (
    <div className="space-y-3 border-t border-border/40 px-4 py-3">
      <h2 className="text-xs font-semibold text-text-muted">
        {t('sidePanel.thisConversation', { defaultValue: 'This conversation' })}
      </h2>

      {internal ? null : (
      <div className="space-y-0.5">
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

        <Row label={t('sidePanel.lookAgain', { defaultValue: 'Look again' })}>
          {thread.followUpAt ? (
            <button
              type="button"
              onClick={onWhatsNext}
              disabled={!onWhatsNext}
              title={thread.followUpTitle || undefined}
              className={VALUE_BUTTON}
            >
              <ListPlus size={11} className="shrink-0 text-text-muted" />
              <span className="truncate-fade">{followUpWake ?? thread.followUpTitle}</span>
            </button>
          ) : onWhatsNext ? (
            <button type="button" onClick={onWhatsNext} className={`${VALUE_BUTTON} text-text-secondary`}>
              <ListPlus size={11} />
              {t('sidePanel.plan', { defaultValue: 'Plan' })}
            </button>
          ) : (
            <span className="text-xs text-text-muted">—</span>
          )}
        </Row>
      </div>
      )}

      {!internal && hasTriage ? (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-text-secondary">
            <Sparkles size={11} className="shrink-0 text-ai-ink" />
            {triage.category ? <span className="capitalize text-text-heading">{triage.category}</span> : null}
            {triage.urgency != null ? (
              <span className="text-text-muted">{t('triage.urgency', { value: triage.urgency })}</span>
            ) : null}
            {triage.certainty != null ? (
              <span className="text-text-muted">{t('triage.certainty', { value: triage.certainty })}</span>
            ) : null}
          </div>
          <p className="text-xs leading-relaxed text-text-muted">
            {triage.summary?.trim() || t('triage.summaryFallback')}
          </p>
        </div>
      ) : null}

      <ThreadCategory
        signalId={String(thread.id)}
        version={`${thread.categoryCase?.caseId ?? ''}|${thread.categoryCase?.status ?? ''}|${thread.categoryCase?.stage?.key ?? ''}`}
      />

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-text-muted">{t('tags.title', { defaultValue: 'Tags' })}</p>
        <ThreadTags thread={thread} saving={saving} onPatch={onPatch} />
      </div>
    </div>
  )
}
