import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useCommunicationNav } from '../../hooks/useCommunicationNav'
import { formatAppDate } from '../../lib/app-locale'
import { ENTITY_ICONS } from '../../lib/entity-icons'
import type { InboxThread } from '../../lib/inbox-api'
import { openEntityPath } from '../../lib/open-entity'
import { navRowIndex } from '../../lib/signals-api'
import { parseServerTime } from '../../lib/thread-schedule'
import { cn } from '../../lib/utils'

const FolderIcon = ENTITY_ICONS.project
const CalendarClock = ENTITY_ICONS.agenda

/**
 * The project folders this contact's conversations are filed in, as links.
 * Shows where the contact lives in the company's work; hidden when none.
 */
export function ContactFolderChips({ threads }: { threads: InboxThread[] }) {
  const { t } = useTranslation('nav')
  const { nav } = useCommunicationNav()
  const folders = useMemo(() => {
    const index = navRowIndex(nav.projects)
    const counts = new Map<string, number>()
    for (const thread of threads) {
      if (thread.projectId) counts.set(thread.projectId, (counts.get(thread.projectId) ?? 0) + 1)
    }
    return [...counts.entries()]
      .flatMap(([id, count]) => {
        const row = index.get(id)
        return row ? [{ id, count, ...row }] : []
      })
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [nav.projects, threads])
  if (folders.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="contact-folders">
      <span className="text-xs text-text-muted">{t('contactsPage.inFolders')}</span>
      {folders.map((folder) => (
        <Link
          key={folder.id}
          to={openEntityPath({ type: 'project', id: folder.id })}
          className="inline-flex h-6 max-w-[14rem] items-center gap-1 rounded-md border border-border/70 px-2 text-xs text-text-heading transition-colors hover:border-accent/40 hover:text-accent"
          title={folder.path}
        >
          <FolderIcon size={11} className="shrink-0 text-text-muted" aria-hidden />
          <span className="truncate">{folder.name}</span>
          {folder.count > 1 ? <span className="tabular-nums text-text-muted">{folder.count}</span> : null}
        </Link>
      ))}
    </div>
  )
}

/** `klacht · Waiting - ` before a contact's conversation status, when it is a ticket. */
export function ThreadTicketPrefix({ thread }: { thread: InboxThread }) {
  const ticket = thread.ticket
  if (!ticket || ticket.status === 'proposed') return null
  return (
    <span className="font-medium text-accent">
      {ticket.name.replace(/^#/, '')}
      {ticket.stage?.name ? ` · ${ticket.stage.name}` : ''}
      {' - '}
    </span>
  )
}

/** The conversation's date; amber once it is due. */
export function ThreadLookAt({ thread }: { thread: InboxThread }) {
  const { t, i18n } = useTranslation('nav')
  const at = parseServerTime(thread.nextAt)
  if (!at) return null
  const due = at.getTime() <= Date.now()
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1 text-2xs tabular-nums', due ? 'text-status-warning' : 'text-text-muted')}
      title={t('contactsPage.lookAt')}
    >
      <CalendarClock size={11} aria-hidden />
      {formatAppDate(at, i18n.language, { day: 'numeric', month: 'short' })}
    </span>
  )
}
