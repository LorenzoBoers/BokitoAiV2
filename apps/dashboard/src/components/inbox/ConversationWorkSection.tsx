import { ArrowUpRight, ChevronDown } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useCommunicationNav } from '../../hooks/useCommunicationNav'
import type { InboxThread, PatchThreadInput, ProposalItem } from '../../lib/inbox-api'
import { ENTITY_ICONS } from '../../lib/entity-icons'
import { isInternalThread } from '../../lib/message-composer'
import { canvasOnThreadPath, openEntityPath } from '../../lib/open-entity'
import { listCanvasesForThread, type ProjectCanvas } from '../../lib/project-canvas-api'
import { findNavRowPath, type NavRow } from '../../lib/signals-api'
import { CanvasShowcaseCard } from './ProposalItemPreview'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { SettingRow } from '../ui/entity-row'
import { SectionLabel } from '../ui/section-label'
import { controlTextClass } from '../ui/select'
import { ScheduleSection } from './ScheduleSection'
import { ThreadCategory } from './ThreadCategory'
import { ThreadTags } from './ThreadTags'

type Props = {
  thread: InboxThread
  saving?: boolean
  onPatch?: (input: PatchThreadInput) => Promise<boolean | void>
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

const VALUE_BUTTON = controlTextClass
const FolderIcon = ENTITY_ICONS.project

type FolderChoice = { id: string; name: string; depth: number }

/** Side panel shows the folder itself. Ancestors stay on the tooltip. */
function projectFolderLabel(
  thread: InboxThread,
  projectId: string | null,
  projects: NavRow[],
  emptyLabel: string,
  missingLabel: string,
): { name: string; path: string | null } {
  if (!projectId) return { name: emptyLabel, path: null }
  const chain = findNavRowPath(projects, projectId)?.map((row) => row.name).filter(Boolean)
  const stored = thread.folderPaths?.find((path) => path.projectId === projectId)?.label
  const parts = chain?.length
    ? chain
    : stored
      ? stored.replace(/#/g, '').split('/').map((part) => part.trim()).filter(Boolean)
      : []
  if (!parts.length) return { name: missingLabel, path: null }
  const path = parts.join(' / ')
  return { name: parts[parts.length - 1] ?? missingLabel, path: parts.length > 1 ? path : null }
}

function flattenFolders(rows: NavRow[], depth = 0): FolderChoice[] {
  return rows.flatMap((row) =>
    row.virtual ? [] : [{ id: row.id, name: row.name, depth }, ...flattenFolders(row.children ?? [], depth + 1)],
  )
}

function canvasItem(
  row: ProjectCanvas,
  cadence: string,
  writingLabel: string,
  kindLabel: string,
  here: string,
): ProposalItem {
  const empty = Boolean(row.empty)
  const dashboard = (row.kind || 'dashboard') === 'dashboard'
  const home = row.thread?.path || here
  return {
    type: 'canvas',
    id: row.id,
    title: row.title,
    canvasKind: row.kind || 'dashboard',
    subtitle: empty
      ? writingLabel
      : [kindLabel, row.managing_agent?.name, dashboard ? cadence : null].filter(Boolean).join(' · '),
    path: empty ? null : canvasOnThreadPath(home, row.id),
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
  const { pathname, search } = useLocation()
  const { nav } = useCommunicationNav()
  const [ticketBump, setTicketBump] = useState(0)
  const [canvases, setCanvases] = useState<ProjectCanvas[]>([])
  const priority = thread.priority || 'normal'
  const priorityMeta = PRIORITY_META[priority] ?? PRIORITY_META.normal
  const internal = isInternalThread(thread)
  const folders = flattenFolders(nav.projects)
  const projectId = thread.projectId ?? null
  const project = projectFolderLabel(
    thread,
    projectId,
    nav.projects,
    t('tickets.noProject', { ns: 'nav' }),
    t('tickets.project', { ns: 'nav' }),
  )

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

  return (
    <div className="space-y-2 border-t border-border/40 px-4 py-3">
      <SectionLabel
        title={t('sidePanel.thisConversation', { defaultValue: 'This conversation' })}
        className="[&_.nav-folder]:h-5 [&_.nav-folder]:text-2xs [&_.nav-folder]:font-normal"
        headerClassName="-mx-1"
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
                t(`projects.canvas.kinds.${row.kind || 'dashboard'}`, { ns: 'nav' }),
                `${pathname}${search}`,
              )}
            />
          ))}
        </div>
      ) : null}

      <div className="divide-y divide-border/40">
        <Row label={t('tickets.project', { ns: 'nav' })}>
          <span className="inline-flex min-w-0 items-center gap-0.5">
            {folders.length > 0 && onPatch ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={saving}
                    aria-label={t('tickets.project', { ns: 'nav' })}
                    className={VALUE_BUTTON}
                  >
                    <FolderIcon size={12} className="shrink-0 text-text-muted" />
                    <span className="truncate" title={project.path ?? undefined}>{project.name}</span>
                    <ChevronDown size={10} className="text-text-muted" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
                  {folders.map((choice) => (
                    <DropdownMenuItem
                      key={choice.id}
                      className="gap-2 text-xs"
                      style={{ paddingLeft: 8 + choice.depth * 12 }}
                      disabled={saving || projectId === choice.id}
                      onSelect={() => {
                        void onPatch({ projectId: choice.id })
                        setTicketBump((n) => n + 1)
                      }}
                    >
                      <FolderIcon size={12} className="text-text-muted" />
                      {choice.name}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem
                    className="text-xs text-text-secondary"
                    disabled={saving || projectId === null}
                    onSelect={() => {
                      void onPatch({ projectId: null })
                      setTicketBump((n) => n + 1)
                    }}
                  >
                    {t('tickets.noProject', { ns: 'nav' })}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-text-heading">
                <FolderIcon size={12} className="shrink-0 text-text-muted" />
                <span className="truncate" title={project.path ?? undefined}>{project.name}</span>
              </span>
            )}
            {projectId ? (
              <Link
                to={openEntityPath({ type: 'project', id: projectId })}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-accent"
                aria-label={t('tickets.openProject', { ns: 'nav' })}
                title={t('tickets.openProject', { ns: 'nav' })}
              >
                <ArrowUpRight size={12} />
              </Link>
            ) : null}
          </span>
        </Row>
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
        version={`${thread.ticket?.tagId ?? ''}|${thread.ticket?.status ?? ''}|${thread.ticket?.stage?.key ?? ''}|${thread.projectId ?? ''}|${ticketBump}`}
      />
    </div>
  )
}
