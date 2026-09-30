import { Bot, Send, StickyNote } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useConversationActions } from '@/api/queries'
import type { Conversation } from '@/api/types'
import { cn } from '@/lib/cn'

type Mode = 'reply' | 'note' | 'agent'

export function Composer({ conversation }: { conversation: Conversation }) {
  const { t } = useTranslation()
  const actions = useConversationActions(conversation.id)
  const [mode, setMode] = useState<Mode>(conversation.channel === 'internal' ? 'agent' : 'reply')
  const [text, setText] = useState('')
  const busy = actions.reply.isPending || actions.note.isPending || actions.askAgent.isPending

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    const body = text.trim()
    try {
      if (mode === 'reply') {
        if (!body) return
        const out = await actions.reply.mutateAsync({ body })
        if (out.status === 'decision') toast.message(t('communication.replyNeedsDecision'))
        else if (out.status === 'denied') toast.error(out.reason || t('communication.denied'))
      } else if (mode === 'note') {
        if (!body) return
        await actions.note.mutateAsync(body)
      } else {
        if (body) await actions.note.mutateAsync(body)
        await actions.askAgent.mutateAsync(undefined)
        toast.message(t('communication.agentQueued'))
      }
      setText('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    }
  }

  const modes: Array<{ id: Mode; label: string; icon: typeof Send }> = [
    { id: 'reply', label: t('communication.reply'), icon: Send },
    { id: 'note', label: t('communication.note'), icon: StickyNote },
    { id: 'agent', label: t('communication.askAgent'), icon: Bot },
  ]

  return (
    <form onSubmit={submit} className="border-t border-border/60 p-3">
      <div className="mb-2 flex items-center gap-1">
        {modes.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-secondary hover:bg-bg-hover',
              mode === id && 'bg-bg-hover text-text-heading',
              id === 'agent' && mode === id && 'text-ai-ink',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>
      <textarea
        className={cn('field min-h-[84px] resize-y', mode === 'note' && 'bg-status-warning/5')}
        placeholder={t(`communication.placeholder.${mode}`)}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit()
        }}
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-2xs text-text-muted">{t('communication.sendHint')}</span>
        <button type="submit" className={mode === 'agent' ? 'btn-outline' : 'btn-primary'} disabled={busy || (mode !== 'agent' && !text.trim())}>
          {mode === 'reply' ? t('communication.send') : mode === 'note' ? t('communication.addNote') : t('communication.runAgent')}
        </button>
      </div>
    </form>
  )
}
