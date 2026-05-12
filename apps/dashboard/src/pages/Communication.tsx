import { Mail } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import ThreadList from '../components/inbox/ThreadList'
import ThreadDetail from '../components/inbox/ThreadDetail'
import { useMailboxConnections } from '../hooks/useMailboxConnections'
import { useThreads } from '../hooks/useThreads'
import { useThreadDetail } from '../hooks/useThreadDetail'
import type { ThreadFilters } from '../lib/inbox-api'

type View = NonNullable<ThreadFilters['view']>

const QUEUE_TO_VIEW: Record<string, View> = {
  all: 'all_open',
  all_open: 'all_open',
  my: 'mine',
  mine: 'mine',
  unassigned: 'unassigned',
  pending: 'pending',
  closed: 'closed',
  spam: 'spam',
  out: 'outbound',
  outbound: 'outbound',
  created: 'mine',
}


export default function Communication() {
  const { t } = useTranslation('communication')
  const { queue, channelId } = useParams<{ queue: string; channelId?: string }>()

  // URL is the single source of truth for the current view
  const view: View = (queue ? QUEUE_TO_VIEW[queue] : undefined) ?? 'all_open'
  const connectionId = channelId ? Number(channelId) : undefined

  const [search, setSearch] = useState('')
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null)

  const {
    connections,
    loading: connectionsLoading,
    error: connectionsError,
    needsOrganisation,
  } = useMailboxConnections()

  // Show inbox if there's at least one enabled connection (active or error — not revoked)
  const enabledConnections = connections.filter(
    (c) => c.status !== 'revoked' && c.isEnabled !== false,
  )

  const { threads, loading: threadsLoading, error: threadsError, refresh: refreshThreads } = useThreads({ view, search, connectionId })

  const { detail, loading: detailLoading, saving, refresh: refreshDetail, patch, reply, addNote } = useThreadDetail(selectedThreadId)

  const handleReply = async (bodyText: string, action: 'send' | 'send_and_close' | 'send_and_pending') => {
    await reply({ bodyText, action })
  }

  if (connectionsLoading) {
    return <div className="h-full py-6 text-sm text-text-muted">{t('loadingMailboxes')}</div>
  }

  if (connectionsError) {
    return <div className="h-full py-6 text-sm text-status-error">{connectionsError}</div>
  }

  if (needsOrganisation) {
    return (
      <div className="h-full py-6 text-sm text-text-muted max-w-md">
        {t('missingOrganisation')}
      </div>
    )
  }

  if (enabledConnections.length === 0) {
    return (
      <div className="h-full min-h-0 flex flex-col items-center justify-center py-8 px-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center mb-4">
          <Mail size={28} className="text-accent" />
        </div>
        <h2 className="text-lg font-semibold text-text-heading">{t('noActiveMailboxTitle')}</h2>
        <p className="text-sm text-text-secondary mt-2 max-w-sm">
          {t('noActiveMailboxDescription')}
        </p>
        <Link
          to="/settings/inbox"
          className="mt-5 text-sm font-medium text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-sm"
        >
          {t('openEmailSettings')}
        </Link>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden rounded-md">
      <ThreadList
        threads={threads}
        loading={threadsLoading}
        error={threadsError}
        selectedId={selectedThreadId}
        search={search}
        onSelectThread={(id) => {
          setSelectedThreadId(id)
          void refreshThreads()
        }}
        onSearchChange={setSearch}
      />
      <ThreadDetail
        detail={detail}
        loading={detailLoading}
        saving={saving}
        onPatch={patch}
        onReply={handleReply}
        onNote={addNote}
        onRefresh={refreshDetail}
      />
    </div>
  )
}
