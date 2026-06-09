import { useEffect, useMemo, useState } from 'react'
import { Archive, Reply, ReplyAll, Search, Tag } from 'lucide-react'
import {
  aiAnalyzeSentiment,
  aiCategorizeMessage,
  aiSuggestReply,
  searchKbContext,
  aiSummarizeMessage,
  patchEmailMessage,
  snoozeEmailMessage,
  type EmailMessage,
} from '../../lib/email-api'
import { useAuth } from '../../context/AuthContext'
import ComposeArea from './ComposeArea'

function MailRow({
  message,
  selected,
  onClick,
}: {
  message: EmailMessage
  selected: boolean
  onClick: () => void
}) {
  const preview = message.bodyPreview
  const subject = message.subject || 'No subject'
  const fromName = message.fromAddress.split('@')[0] || message.fromAddress
  const timestamp = message.receivedAt ? new Date(message.receivedAt).toLocaleString() : '-'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left border-b border-border/60 px-4 py-2.5 transition-colors ${
        selected ? 'bg-bg-hover/60' : 'hover:bg-bg-hover/40'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 rounded-full bg-bg-elevated/55 flex items-center justify-center text-[10px] font-semibold text-text-secondary flex-shrink-0 mt-0.5">
          {fromName.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[12px] truncate ${!message.isRead ? 'font-semibold text-text-primary' : 'font-medium text-text-secondary'}`}>
              {message.fromAddress}
            </span>
            <span className="text-[11px] text-text-muted">{timestamp}</span>
            {!message.isRead && (
              <span className="inline-flex h-2 w-2 rounded-full bg-accent" />
            )}
            {message.sentiment === 'urgent' ? <span className="text-2xs text-status-error">Urgent</span> : null}
          </div>
          <div className="text-[12px] text-text-primary truncate mt-0.5">{subject}</div>
          <div className="text-[12px] text-text-muted truncate mt-0.5">{preview}</div>
          {message.labels.length > 0 && (
            <div className="flex gap-1 mt-1.5">
              {message.labels.map((label, index) => (
                <span
                  key={`${label}-${index}`}
                  className="px-1.5 py-0.5 rounded text-[10px] bg-accent/15 text-accent"
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </button>
  )
}

function MailPreview({
  message,
  aiSuggestion,
  citations,
  onUseSuggestion,
  onGenerateAi,
  aiBusy,
}: {
  message: EmailMessage | null
  aiSuggestion: string | null
  citations: Array<{ id: number; filename: string; file_url: string }>
  onUseSuggestion: () => void
  onGenerateAi: () => void
  aiBusy: boolean
}) {
  if (!message) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-text-muted">
        Selecteer een bericht om de inhoud te bekijken.
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-4 py-3 border-b border-border/70">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[15px] font-semibold text-text-heading">
              {message.subject || 'No subject'}
            </div>
            <div className="text-xs text-text-muted mt-0.5">
              Van: {message.fromAddress} • {message.receivedAt ? new Date(message.receivedAt).toLocaleString() : '-'}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button className="p-1.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary">
              <Reply size={14} />
            </button>
            <button className="p-1.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary">
              <ReplyAll size={14} />
            </button>
            <button className="p-1.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary">
              <Archive size={14} />
            </button>
          </div>
        </div>
      </div>
      <div className="px-4 py-3 overflow-y-auto">
        {message.labels.length > 0 && (
          <div className="flex items-center gap-1.5 mb-3">
            <Tag size={12} className="text-text-muted" />
            {message.labels.map((label, index) => (
              <span
                key={`${label}-${index}`}
                className="px-2 py-0.5 rounded text-[10px] bg-accent/15 text-accent"
              >
                {label}
              </span>
            ))}
          </div>
        )}
        {aiSuggestion ? (
          <div className="mb-3 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs">
            <div className="font-medium text-accent mb-1">AI suggestie</div>
            <div className="text-text-secondary mb-2">{aiSuggestion}</div>
            {citations.length > 0 ? (
              <div className="mb-2 text-2xs text-text-muted">
                {citations.map((item, index) => (
                  <div key={item.id}>
                    [{index + 1}] {item.filename}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="flex items-center gap-1">
              <button type="button" className="px-2 py-1 rounded border border-accent/30 text-accent" onClick={onUseSuggestion}>
                Gebruik als antwoord
              </button>
              <button type="button" className="px-2 py-1 rounded border border-border text-text-secondary" onClick={onUseSuggestion}>
                Bewerk
              </button>
              <button type="button" className="px-2 py-1 rounded border border-border text-text-secondary" onClick={onGenerateAi}>
                Negeer
              </button>
            </div>
          </div>
        ) : (
          <div className="mb-3">
            <button
              type="button"
              className="px-2 py-1 rounded border border-accent/30 text-accent text-xs"
              onClick={onGenerateAi}
              disabled={aiBusy}
            >
              {aiBusy ? 'AI verwerkt...' : 'Genereer AI suggestie'}
            </button>
          </div>
        )}
        {message.aiSummary ? <div className="mb-3 rounded-md border border-border px-3 py-2 text-xs text-text-secondary">{message.aiSummary}</div> : null}
        <div className="text-[13px] text-text-secondary leading-relaxed whitespace-pre-line">
          {message.bodyHtml ? message.bodyHtml : message.bodyPreview}
        </div>
      </div>
    </div>
  )
}

type MessageAreaProps = {
  messages: EmailMessage[]
  selectedId: number | null
  onSelectId: (id: number) => void
  loading: boolean
  error: string | null
  connectionId: number | null
  onRefresh: () => void
  onFilterChange: (value: 'all' | 'unread' | 'urgent') => void
  onSearchChange: (value: string) => void
}

export default function MessageArea({
  messages,
  selectedId,
  onSelectId,
  loading,
  error,
  connectionId,
  onRefresh,
  onFilterChange,
  onSearchChange,
}: MessageAreaProps) {
  const { token } = useAuth()
  const [filter, setFilter] = useState<'all' | 'unread' | 'urgent'>('all')
  const [search, setSearch] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState<Record<number, string>>({})
  const [aiCitations, setAiCitations] = useState<Record<number, Array<{ id: number; filename: string; file_url: string }>>>({})
  const [composeDraft, setComposeDraft] = useState<string | null>(null)
  const filteredMessages = useMemo<EmailMessage[]>(() => messages, [messages])

  const selectedMessage = useMemo(
    () => filteredMessages.find((m) => m.id === selectedId) ?? filteredMessages[0] ?? null,
    [selectedId, filteredMessages],
  )

  useEffect(() => {
    if (selectedMessage && selectedMessage.id !== selectedId) {
      onSelectId(selectedMessage.id)
    }
  }, [selectedMessage, selectedId, onSelectId])

  async function handlePatchCurrent(patch: Parameters<typeof patchEmailMessage>[2]) {
    if (!token || !selectedMessage) return
    setActionBusy(true)
    try {
      await patchEmailMessage(token, selectedMessage.id, patch)
      await onRefresh()
    } finally {
      setActionBusy(false)
    }
  }

  async function handleSnoozeCurrent() {
    if (!token || !selectedMessage) return
    setActionBusy(true)
    try {
      const nextHour = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      await snoozeEmailMessage(token, selectedMessage.id, nextHour)
      await onRefresh()
    } finally {
      setActionBusy(false)
    }
  }

  async function runAiActionsForCurrent() {
    if (!token || !selectedMessage) return
    setAiBusy(true)
    try {
      const [suggest, _summary, _sentiment, _labels, citations] = await Promise.all([
        aiSuggestReply(token, selectedMessage.id),
        aiSummarizeMessage(token, selectedMessage.id),
        aiAnalyzeSentiment(token, selectedMessage.id),
        aiCategorizeMessage(token, selectedMessage.id),
        searchKbContext(token, selectedMessage.subject || selectedMessage.bodyPreview, 3),
      ])
      setAiSuggestions((prev) => ({ ...prev, [selectedMessage.id]: suggest.suggestion }))
      setAiCitations((prev) => ({ ...prev, [selectedMessage.id]: citations }))
      await onRefresh()
    } finally {
      setAiBusy(false)
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!selectedMessage) return
      if (event.key.toLowerCase() === 'e') {
        event.preventDefault()
        void handlePatchCurrent({
          conversation_status: selectedMessage.conversationStatus === 'closed' ? 'open' : 'closed',
        })
      }
      if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        void handleSnoozeCurrent()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedMessage])

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full bg-transparent">
      <div className="h-11 flex items-center px-4 border-b border-border/70 flex-shrink-0">
        <div>
          <div className="text-[12px] font-semibold text-text-heading">Mailbox / Klantvragen</div>
          <div className="text-[11px] text-text-muted">{filteredMessages.length} berichten</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1">
            {[
              { id: 'all', label: 'Alle' },
              { id: 'unread', label: 'Ongelezen' },
              { id: 'urgent', label: 'Urgent' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  const value = item.id as 'all' | 'unread' | 'urgent'
                  setFilter(value)
                  onFilterChange(value)
                }}
                className={`px-2 py-1 rounded text-[10px] border ${
                  filter === item.id
                    ? 'bg-accent/10 text-accent border-accent/25'
                    : 'text-text-muted border-border hover:bg-bg-hover'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-muted">
            <Search size={12} />
            <input
              value={search}
              onChange={(event) => {
                const value = event.target.value
                setSearch(value)
                onSearchChange(value)
              }}
              className="bg-transparent outline-none w-44 text-[11px]"
              placeholder="Zoek op afzender, onderwerp..."
            />
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[minmax(320px,42%)_1fr]">
        <div className="border-r border-border/70 overflow-y-auto">
          {loading ? <div className="px-4 py-3 text-xs text-text-muted">Berichten laden...</div> : null}
          {error ? <div className="px-4 py-3 text-xs text-status-error">{error}</div> : null}
          {!loading && !error && filteredMessages.length === 0 ? (
            <div className="px-4 py-3 text-xs text-text-muted">No messages found for this mailbox.</div>
          ) : null}
          {filteredMessages.map((msg) => (
            <MailRow
              key={msg.id}
              message={msg}
              selected={msg.id === (selectedMessage?.id ?? selectedId)}
              onClick={() => onSelectId(msg.id)}
            />
          ))}
        </div>
        <div className="bg-bg-surface/30 flex flex-col min-h-0">
          {selectedMessage ? (
            <div className="flex items-center gap-1 border-b border-border/70 px-3 py-2">
              <button
                type="button"
                disabled={actionBusy}
                className="px-2 py-1 rounded text-[10px] border border-border text-text-secondary hover:bg-bg-hover"
                onClick={() => void handlePatchCurrent({ is_read: !selectedMessage.isRead })}
              >
                {selectedMessage.isRead ? 'Markeer ongelezen' : 'Markeer gelezen'}
              </button>
              <button
                type="button"
                disabled={actionBusy}
                className="px-2 py-1 rounded text-[10px] border border-border text-text-secondary hover:bg-bg-hover"
                onClick={() =>
                  void handlePatchCurrent({
                    conversation_status: selectedMessage.conversationStatus === 'closed' ? 'open' : 'closed',
                  })
                }
              >
                {selectedMessage.conversationStatus === 'closed' ? 'Heropen' : 'Sluit'}
              </button>
              <button
                type="button"
                disabled={actionBusy}
                className="px-2 py-1 rounded text-[10px] border border-border text-text-secondary hover:bg-bg-hover"
                onClick={() => void handleSnoozeCurrent()}
              >
                Snooze 1u
              </button>
              <button
                type="button"
                disabled={actionBusy}
                className="px-2 py-1 rounded text-[10px] border border-border text-text-secondary hover:bg-bg-hover"
                onClick={() => {
                  const input = window.prompt('Wijs toe aan user id', selectedMessage.assignedToUserId ? String(selectedMessage.assignedToUserId) : '')
                  if (!input) return
                  const userId = Number(input)
                  if (!Number.isFinite(userId)) return
                  void handlePatchCurrent({ assigned_to_user_id: userId })
                }}
              >
                Toewijzen
              </button>
              <button
                type="button"
                disabled={actionBusy}
                className="px-2 py-1 rounded text-[10px] border border-border text-text-secondary hover:bg-bg-hover"
                onClick={() => {
                  const input = window.prompt('Labels (komma gescheiden)', selectedMessage.labels.join(', '))
                  if (input == null) return
                  const labels = input
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean)
                  void handlePatchCurrent({ labels })
                }}
              >
                Labels
              </button>
            </div>
          ) : null}
          <MailPreview
            message={selectedMessage}
            aiSuggestion={selectedMessage ? aiSuggestions[selectedMessage.id] ?? null : null}
            citations={selectedMessage ? aiCitations[selectedMessage.id] ?? [] : []}
            onUseSuggestion={() => {
              if (!selectedMessage) return
              const suggestion = aiSuggestions[selectedMessage.id]
              if (suggestion) setComposeDraft(suggestion)
            }}
            onGenerateAi={() => void runAiActionsForCurrent()}
            aiBusy={aiBusy}
          />
          <ComposeArea
            connectionId={connectionId}
            selectedMessage={selectedMessage}
            externalDraft={composeDraft}
            onSent={() => {
              setComposeDraft(null)
              void onRefresh()
            }}
          />
        </div>
      </div>
    </div>
  )
}
