import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { ENTITY_ICONS } from '../../lib/entity-icons'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { ChannelGlyph } from '../ui/ChannelGlyph'
import { SegmentedControl } from '../ui/segmented-control'
import { ThreadStatusDot } from '../ui/ThreadStatusDot'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { useAuth } from '../../context/AuthContext'
import { listThreads, type InboxThread } from '../../lib/inbox-api'
import { projectHubPath } from '../../lib/messages-paths'
import { withNavReveal } from '../../lib/nav-reveal'
import { listProjects } from '../../lib/projects-api'
import { threadStatusLabel } from '../../lib/status-labels'
import { timeAgo } from '../../lib/time-ago'
import { cn } from '../../lib/utils'

const MessageSquare = ENTITY_ICONS.conversation

type StatusFilter = 'open' | 'closed'

const PAGE_SIZE = 30
const PREVIEW_SIZE = 5

/**
 * Every conversation filed on this project or a folder inside it — the same
 * list as the project's folder in the Communication sidebar, read here next
 * to the folders and boards. `preview` shows the first few open ones with a
 * link to the full tab.
 */
export function ProjectConversations({
  projectId,
  preview = false,
  onShowAll,
  refreshKey,
}: {
  projectId: string
  preview?: boolean
  onShowAll?: () => void
  /** Bump to reload (e.g. after the project itself refreshed). */
  refreshKey?: number
}) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [filter, setFilter] = useState<StatusFilter>('open')
  const [threads, setThreads] = useState<InboxThread[] | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [nextPage, setNextPage] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [folderNames, setFolderNames] = useState<Record<string, string>>({})

  const perPage = preview ? PREVIEW_SIZE : PAGE_SIZE
  const view = filter === 'closed' ? 'closed' : 'all_open'

  const load = useCallback(
    async (page: number, append: boolean) => {
      if (!token) return
      if (!append) {
        setThreads(null)
        setError(null)
      }
      try {
        const result = await listThreads(token, { projectId, view, page, perPage })
        setThreads((prev) => {
          if (!append || !prev) return result.items
          const seen = new Set(prev.map((row) => String(row.id)))
          return [...prev, ...result.items.filter((row) => !seen.has(String(row.id)))]
        })
        setTotal(result.itemsTotal)
        setNextPage(result.nextPage)
      } catch (err) {
        setError(formatApiErrorMessage(err, t('projects.detail.conversationsLoadError')))
        if (!append) setThreads([])
      }
    },
    [perPage, projectId, t, token, view],
  )

  useEffect(() => {
    void load(1, false)
  }, [load, refreshKey])

  // Names for the folder a conversation sits in, when deeper than this project.
  useEffect(() => {
    let cancelled = false
    void listProjects()
      .then((rows) => {
        if (cancelled) return
        setFolderNames(Object.fromEntries(rows.map((row) => [row.id, row.name])))
      })
      .catch(() => {
        if (!cancelled) setFolderNames({})
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const loadMore = async () => {
    if (!nextPage || loadingMore) return
    setLoadingMore(true)
    try {
      await load(nextPage, true)
    } finally {
      setLoadingMore(false)
    }
  }

  const hubHref = withNavReveal(projectHubPath(projectId, filter === 'closed' ? 'closed' : 'open'))
  const rows = useMemo(() => threads ?? [], [threads])
  const countLabel = total != null ? ` (${total})` : ''

  return (
    <section className="space-y-3" aria-labelledby={`project-conversations-${preview ? 'preview' : 'all'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2
            id={`project-conversations-${preview ? 'preview' : 'all'}`}
            className="text-sm font-semibold text-text-heading"
          >
            {preview ? t('projects.detail.recentConversations') : t('projects.detail.conversationsTitle')}
            {!preview && countLabel ? <span className="font-normal text-text-muted">{countLabel}</span> : null}
          </h2>
          {!preview ? <p className="text-xs text-text-muted">{t('projects.detail.conversationsHint')}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {!preview ? (
            <SegmentedControl<StatusFilter>
              size="sm"
              value={filter}
              onChange={setFilter}
              aria-label={t('projects.detail.conversationsFilter')}
              options={[
                { value: 'open', label: t('projects.detail.filterOpen') },
                { value: 'closed', label: t('projects.detail.filterClosed') },
              ]}
            />
          ) : null}
          <Link
            to={hubHref}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-muted transition-colors hover:bg-bg-hover/70 hover:text-text-primary"
          >
            <MessageSquare size={13} aria-hidden />
            {t('projects.detail.openInCommunication')}
            <ArrowUpRight size={12} aria-hidden className="opacity-70" />
          </Link>
        </div>
      </div>

      {threads == null ? (
        <div className="space-y-1.5" aria-busy="true">
          {Array.from({ length: preview ? 3 : 5 }).map((_, index) => (
            <div key={index} className="h-11 animate-pulse rounded-lg bg-bg-muted/30" />
          ))}
        </div>
      ) : error && rows.length === 0 ? (
        <Card className="p-4">
          <p className="text-sm text-status-error">{error}</p>
        </Card>
      ) : rows.length === 0 ? (
        <Card className="p-4">
          <p className="text-sm text-text-muted">
            {filter === 'closed'
              ? t('projects.detail.conversationsEmptyClosed')
              : t('projects.detail.conversationsEmpty')}
          </p>
        </Card>
      ) : (
        <Card className="divide-y divide-border/50 p-1">
          {rows.map((thread) => (
            <ConversationRow
              key={String(thread.id)}
              thread={thread}
              projectId={projectId}
              queue={filter}
              folderName={
                thread.projectId && thread.projectId !== projectId ? folderNames[thread.projectId] : undefined
              }
            />
          ))}
        </Card>
      )}

      {preview && onShowAll && (total ?? rows.length) > 0 ? (
        <button
          type="button"
          onClick={onShowAll}
          className="text-xs font-medium text-accent hover:underline"
        >
          {t('projects.detail.allConversations', { count: total ?? rows.length })}
        </button>
      ) : null}
      {!preview && nextPage ? (
        <Button type="button" size="sm" variant="ghost" disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? t('projects.detail.loadingMoreConversations') : t('projects.detail.loadMoreConversations')}
        </Button>
      ) : null}
    </section>
  )
}

function ConversationRow({
  thread,
  projectId,
  queue,
  folderName,
}: {
  thread: InboxThread
  projectId: string
  queue: StatusFilter
  folderName?: string
}) {
  const { t } = useTranslation('nav')
  const who = thread.contactName || thread.contactEmail || thread.contactPhone || ''
  const tag = thread.ticket?.name ? `#${thread.ticket.name}` : ''
  const meta = [who, folderName ? t('projects.detail.inFolder', { name: folderName }) : '', tag].filter(Boolean)
  return (
    <Link
      to={withNavReveal(projectHubPath(projectId, queue, String(thread.id)))}
      className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-bg-hover/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
    >
      <ThreadStatusDot
        status={thread.status}
        unread={thread.hasUnread}
        title={threadStatusLabel(thread.status, t)}
      />
      <ChannelGlyph channel={thread.channel ?? 'email'} size={14} />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate-fade text-sm text-text-primary',
            thread.hasUnread ? 'font-semibold text-text-heading' : 'font-medium',
          )}
        >
          {thread.emailSubject || t('projects.detail.noSubject')}
        </span>
        {meta.length > 0 ? (
          <span className="block truncate-fade text-xs text-text-muted">{meta.join(' · ')}</span>
        ) : null}
      </span>
      {thread.lastMessageAt ? (
        <span className="shrink-0 text-2xs tabular-nums text-text-muted">{timeAgo(thread.lastMessageAt, t)}</span>
      ) : null}
    </Link>
  )
}
