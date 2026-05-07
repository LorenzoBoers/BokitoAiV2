import { Mail } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import ChannelSidebar from '../components/communication/ChannelSidebar'
import MessageArea from '../components/communication/MessageArea'
import InfoPanel from '../components/communication/InfoPanel'
import { useMailboxConnections } from '../hooks/useMailboxConnections'
import { useEmailMessages } from '../hooks/useEmailMessages'

export default function Communication() {
  const { t } = useTranslation('communication')
  const { queue } = useParams<{ queue?: string }>()
  const [selectedConnectionId, setSelectedConnectionId] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [filter, setFilter] = useState<'all' | 'unread' | 'urgent'>(
    queue === 'unassigned' ? 'unread' : queue === 'created' ? 'urgent' : 'all',
  )
  const [search, setSearch] = useState('')
  const {
    activeConnections,
    loading: connectionsLoading,
    error: connectionsError,
    needsOrganisation,
  } = useMailboxConnections()
  const effectiveConnectionId = selectedConnectionId ?? activeConnections[0]?.id ?? null
  const { messages, loading, error, refresh } = useEmailMessages({
    connectionId: effectiveConnectionId,
    filter,
    search,
  })

  const selectedMessage = useMemo(
    () => messages.find((message) => message.id === selectedId) ?? messages[0] ?? null,
    [messages, selectedId],
  )

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

  if (activeConnections.length === 0) {
    return (
      <div className="h-full min-h-0 flex flex-col items-center justify-center py-8 px-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center mb-4">
          <Mail size={28} className="text-accent" />
        </div>
        <h2 className="text-lg font-semibold text-text-heading">{t('noActiveMailboxTitle')}</h2>
        <p className="text-sm text-text-secondary mt-2 max-w-sm">
          {t('noActiveMailboxDescription')}
        </p>
        <Link to="/settings/support/general" className="mt-5 text-sm font-medium text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-sm">
          {t('openEmailSettings')}
        </Link>
      </div>
    )
  }

  return (
    <div className="flex h-full py-3 overflow-hidden rounded-md">
      <ChannelSidebar
        connections={activeConnections}
        selectedConnectionId={effectiveConnectionId}
        onSelectConnectionId={(id) => {
          setSelectedConnectionId(id)
          setSelectedId(null)
        }}
      />
      <MessageArea
        messages={messages}
        selectedId={selectedId}
        onSelectId={setSelectedId}
        loading={loading}
        error={error}
        connectionId={effectiveConnectionId}
        onRefresh={refresh}
        onFilterChange={setFilter}
        onSearchChange={setSearch}
      />
      <InfoPanel selectedMessage={selectedMessage} messages={messages} />
    </div>
  )
}
