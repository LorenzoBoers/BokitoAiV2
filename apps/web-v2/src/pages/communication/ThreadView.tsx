import { Bot, Coins, Tag, User as UserIcon, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  useAgents,
  useConversation,
  useConversationActions,
  useConversationUsage,
  useFeedbackMutation,
  useMembers,
  useSignalTypes,
  useThread,
} from '@/api/queries'
import type { Conversation, ConversationStatus, Decision, Message } from '@/api/types'
import { ChannelIcon } from '@/components/ChannelIcon'
import { Markdown } from '@/components/Markdown'
import { Avatar, Badge, Empty, Loading, statusTone } from '@/components/ui'
import { useMe } from '@/lib/auth'
import { cn } from '@/lib/cn'
import { dateTime, eur } from '@/lib/format'
import { useTopic } from '@/lib/realtime'

import { Composer } from './Composer'
import { ContactDrawer } from './ContactDrawer'
import { DecisionCard } from './DecisionCard'

const STATUSES: ConversationStatus[] = ['open', 'waiting', 'snoozed', 'closed']

export function ThreadView({ conversationId }: { conversationId: string }) {
  const { t, i18n } = useTranslation()
  const me = useMe()
  const conversation = useConversation(conversationId)
  const thread = useThread(conversationId)
  const usage = useConversationUsage(conversationId)
  const members = useMembers()
  const agents = useAgents()
  const signalTypes = useSignalTypes()
  const actions = useConversationActions(conversationId)
  const feedback = useFeedbackMutation()
  const [contactOpen, setContactOpen] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  useTopic(`conversation:${conversationId}`)

  const conv = conversation.data
  const items = thread.data?.items ?? []
  const decisionsByMessage = useMemo(() => {
    const map = new Map<string, Decision>()
    const orphan: Decision[] = []
    for (const d of thread.data?.decisions ?? []) {
      if (d.message_id) map.set(d.message_id, d)
      else orphan.push(d)
    }
    return { map, orphan }
  }, [thread.data])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [items.length, conversationId])

  if (conversation.isLoading || !conv) return <Loading />

  async function run<T>(p: Promise<T>) {
    try {
      await p
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error'))
    }
  }

  function addTag() {
    const tag = tagDraft.trim()
    if (!tag) return
    void run(actions.setTags.mutateAsync([...conv!.tags, tag]))
    setTagDraft('')
  }

  const signalTypeName = (id: string) => signalTypes.data?.find((s) => s.id === id)?.name ?? t('communication.signal')

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="border-b border-border/60 px-4 py-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-bg-elevated text-text-secondary">
            <ChannelIcon channel={conv.channel} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-text-heading">{conv.subject || t('communication.noSubject')}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
              <Badge tone={statusTone(conv.status)}>{t(`status.${conv.status}`)}</Badge>
              {conv.handoff && <Badge tone="warning">{t('communication.handoff')}</Badge>}
              {(thread.data?.signals ?? []).map((s) => (
                <Badge key={s.id} tone="info">
                  {signalTypeName(s.type_id)}
                  {s.title ? `: ${s.title}` : ''}
                </Badge>
              ))}
              {usage.data && usage.data.total_cost_eur > 0 && (
                <span className="chip" title={t('communication.costHint')}>
                  <Coins className="h-3 w-3" />
                  {eur(usage.data.total_cost_eur, i18n.language, 3)}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <select
              className="field h-8 w-auto text-xs"
              value={conv.status}
              onChange={(e) => void run(actions.setStatus.mutateAsync({ status: e.target.value as ConversationStatus }))}
              aria-label={t('communication.status')}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </select>
            <select
              className="field h-8 w-auto text-xs"
              value={conv.assignee_user_id ?? ''}
              onChange={(e) => void run(actions.assign.mutateAsync({ user_id: e.target.value || null }))}
              aria-label={t('communication.assignee')}
            >
              <option value="">{t('communication.unassigned')}</option>
              {(members.data ?? []).map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name || m.email}
                  {m.user_id === me.data?.user_id ? ` (${t('communication.you')})` : ''}
                </option>
              ))}
            </select>
            <select
              className="field h-8 w-auto text-xs"
              value={conv.agent_id ?? ''}
              onChange={(e) => void run(actions.assign.mutateAsync({ agent_id: e.target.value || null }))}
              aria-label={t('communication.agent')}
            >
              <option value="">{t('communication.noAgent')}</option>
              {(agents.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {conv.contact_id && (
              <button type="button" className="btn-outline h-8 px-2" onClick={() => setContactOpen(true)}>
                <UserIcon className="h-3.5 w-3.5" />
                {t('contacts.title')}
              </button>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <Tag className="h-3 w-3 text-text-muted" />
          {conv.tags.map((tag) => (
            <span key={tag} className="chip">
              {tag}
              <button
                type="button"
                aria-label={t('common.remove')}
                onClick={() => void run(actions.setTags.mutateAsync(conv.tags.filter((x) => x !== tag)))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            className="h-6 w-28 rounded border border-transparent bg-transparent px-1 text-2xs text-text-secondary outline-none placeholder:text-text-muted focus:border-border"
            placeholder={t('communication.addTag')}
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addTag()
              }
            }}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
        {thread.isLoading ? (
          <Loading />
        ) : items.length === 0 && !decisionsByMessage.orphan.length ? (
          <Empty title={t('communication.emptyThread')} />
        ) : (
          <ol className="space-y-3">
            {items.map((m) => (
              <li key={m.id}>
                <MessageRow
                  message={m}
                  conversation={conv}
                  decision={decisionsByMessage.map.get(m.id)}
                  onFeedback={(verdict) =>
                    void run(
                      feedback.mutateAsync({ conversation_id: conv.id, message_id: m.id, run_id: m.run_id ?? undefined, verdict }),
                    ).then(() => toast.success(t('communication.feedbackThanks')))
                  }
                />
              </li>
            ))}
            {decisionsByMessage.orphan.map((d) => (
              <li key={d.id}>
                <DecisionCard decision={d} />
              </li>
            ))}
          </ol>
        )}
        <div ref={bottomRef} />
      </div>

      <Composer conversation={conv} />
      <ContactDrawer contactId={conv.contact_id} open={contactOpen} onOpenChange={setContactOpen} />
    </div>
  )
}

function MessageRow({
  message: m,
  conversation,
  decision,
  onFeedback,
}: {
  message: Message
  conversation: Conversation
  decision?: Decision
  onFeedback: (verdict: 'good' | 'bad') => void
}) {
  const { t, i18n } = useTranslation()
  if (m.kind === 'decision' && decision) return <DecisionCard decision={decision} />
  if (m.kind === 'system' || m.kind === 'run' || m.kind === 'action') {
    return (
      <div className="flex items-center gap-2 px-2 text-2xs text-text-muted">
        <span className="h-px flex-1 bg-border/60" />
        <span>
          {m.body} · {dateTime(m.created_at, i18n.language)}
        </span>
        <span className="h-px flex-1 bg-border/60" />
      </div>
    )
  }
  const isNote = m.kind === 'note'
  const agent = Boolean(m.author_agent_id) || m.ai_generated
  const byUser = Boolean(m.author_user_id) && !agent
  const outbound = byUser || m.direction === 'outbound' || m.direction === 'internal'
  const author = m.author_label || (agent ? t('communication.agent') : outbound ? t('communication.you') : conversation.participants[0]?.name || t('contacts.title'))
  return (
    <div className={cn('flex gap-2.5', outbound && !isNote && 'flex-row-reverse')}>
      <Avatar name={author} tone={agent ? 'ai' : outbound ? 'accent' : 'neutral'} />
      <div className={cn('min-w-0 max-w-[78%]', outbound && !isNote && 'items-end text-right')}>
        <div className={cn('mb-0.5 flex items-center gap-1.5 text-2xs text-text-muted', outbound && !isNote && 'justify-end')}>
          <span className="font-medium text-text-secondary">{author}</span>
          {agent && (
            <Badge tone="ai">
              <Bot className="h-3 w-3" />
              AI
            </Badge>
          )}
          {isNote && <Badge tone="warning">{t('communication.note')}</Badge>}
          <span>{dateTime(m.created_at, i18n.language)}</span>
          {m.send_status !== 'none' && m.send_status !== 'sent' && (
            <Badge tone={statusTone(m.send_status)}>{t(`sendStatus.${m.send_status}`)}</Badge>
          )}
        </div>
        <div
          className={cn(
            'rounded-xl px-3 py-2 text-left',
            isNote
              ? 'border border-status-warning/30 bg-status-warning/5'
              : outbound
                ? agent
                  ? 'border border-ai/30 bg-ai/5'
                  : 'bg-accent/10'
                : 'bg-bg-elevated',
          )}
        >
          <Markdown text={m.body} />
          {m.attachments.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1">
              {m.attachments.map((a, i) => (
                <li key={i} className="chip">
                  {a.url ? (
                    <a href={a.url} target="_blank" rel="noreferrer">
                      {a.name ?? a.url}
                    </a>
                  ) : (
                    a.name
                  )}
                </li>
              ))}
            </ul>
          )}
          {m.send_error && <p className="mt-1 text-2xs text-status-error">{m.send_error}</p>}
        </div>
        {agent && m.direction === 'outbound' && (
          <div className="mt-1 flex justify-end gap-1 text-2xs text-text-muted">
            <button type="button" className="hover:text-text-primary" onClick={() => onFeedback('good')}>
              {t('communication.good')}
            </button>
            <span>·</span>
            <button type="button" className="hover:text-text-primary" onClick={() => onFeedback('bad')}>
              {t('communication.bad')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
