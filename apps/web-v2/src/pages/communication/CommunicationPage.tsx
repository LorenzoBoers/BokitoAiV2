import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { useConversations, useCreateConversation } from '@/api/queries'
import { Dialog, Empty, Field } from '@/components/ui'

import { ConversationList, type ListFilters } from './ConversationList'
import { ThreadView } from './ThreadView'

export function CommunicationPage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const [filters, setFilters] = useState<ListFilters>({ queue: 'attention', channel: '', status: '', q: '' })
  const [newOpen, setNewOpen] = useState(false)
  const list = useConversations({
    queue: filters.queue,
    channel: filters.channel || undefined,
    status: filters.status || undefined,
    q: filters.q || undefined,
  })

  return (
    <div className="flex h-full">
      <aside className="flex w-[360px] shrink-0 flex-col border-r border-border/60">
        <div className="flex h-14 items-center justify-between border-b border-border/60 px-4">
          <div>
            <h1 className="text-sm font-semibold text-text-heading">{t('nav.communication')}</h1>
            <p className="text-2xs text-text-muted">{t('surface.communicationIntro')}</p>
          </div>
          <button type="button" className="btn-primary h-8 px-2.5" onClick={() => setNewOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t('communication.new')}
          </button>
        </div>
        <ConversationList
          items={list.data?.items ?? []}
          counts={list.data?.counts ?? {}}
          loading={list.isLoading}
          filters={filters}
          onFilters={setFilters}
          selectedId={id}
        />
      </aside>
      <section className="min-w-0 flex-1">
        {id ? (
          <ThreadView key={id} conversationId={id} />
        ) : (
          <Empty title={t('communication.pickOne')} hint={t('communication.pickOneHint')} />
        )}
      </section>
      <NewConversationDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  )
}

export function NewConversationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const create = useCreateConversation()
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [askAgent, setAskAgent] = useState(true)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const conv = await create.mutateAsync({ subject, body, ask_agent: askAgent })
      onOpenChange(false)
      setSubject('')
      setBody('')
      navigate(`/communication/${conv.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('communication.newTitle')} description={t('communication.newHint')}>
      <form onSubmit={submit} className="space-y-3">
        <Field label={t('communication.subject')}>
          <input className="field" value={subject} onChange={(e) => setSubject(e.target.value)} autoFocus />
        </Field>
        <Field label={t('communication.message')}>
          <textarea className="field min-h-[120px]" value={body} onChange={(e) => setBody(e.target.value)} required />
        </Field>
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input type="checkbox" checked={askAgent} onChange={(e) => setAskAgent(e.target.checked)} />
          {t('communication.letAgentRespond')}
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn-primary" disabled={create.isPending || !body.trim()}>
            {t('communication.start')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
