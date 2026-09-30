import { Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { useDoc, useDocMutations, useDocs, useKnowledgeSearch } from '@/api/queries'
import type { Doc, DocKind } from '@/api/types'
import { Markdown } from '@/components/Markdown'
import { Badge, Dialog, Empty, Field, Loading, Page, PageHeader, Section, Switch } from '@/components/ui'
import { cn } from '@/lib/cn'
import { dateTime } from '@/lib/format'

const KINDS: Array<DocKind | ''> = ['', 'doc', 'skill', 'persona', 'memory', 'snippet']

export function KnowledgePage() {
  const { t, i18n } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const [kind, setKind] = useState<DocKind | ''>('')
  const [q, setQ] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const docs = useDocs(kind || undefined)
  const search = useKnowledgeSearch(q)
  const m = useDocMutations()

  return (
    <Page>
      <PageHeader
        title={t('nav.knowledge')}
        intro={t('surface.knowledgeIntro')}
        actions={
          <button type="button" className="btn-primary h-8" onClick={() => setNewOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t('knowledge.newDoc')}
          </button>
        }
      />
      <div className="grid min-h-0 flex-1 lg:grid-cols-[320px_1fr]">
        <aside className="flex min-h-0 flex-col border-r border-border/60">
          <div className="space-y-2 border-b border-border/60 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
              <input className="field h-8 pl-7 text-xs" placeholder={t('knowledge.search')} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-1">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn('rounded-md px-2 py-0.5 text-2xs text-text-secondary hover:bg-bg-hover', kind === k && 'bg-bg-hover text-text-heading')}
                >
                  {k ? t(`knowledge.kind.${k}`) : t('knowledge.allKinds')}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {q.trim().length > 1 ? (
              <ul className="divide-y divide-border/40">
                {(search.data ?? []).map((h, i) => (
                  <li key={`${h.doc_id}-${i}`}>
                    <button type="button" onClick={() => navigate(`/knowledge/${h.doc_id}`)} className="w-full px-3 py-2 text-left hover:bg-bg-hover">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="truncate font-medium">{h.title}</span>
                        <span className="ml-auto text-2xs text-text-muted">{h.score.toFixed(2)}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-2xs text-text-muted">{h.text}</p>
                    </button>
                  </li>
                ))}
                {search.data && search.data.length === 0 && <li className="p-3 text-xs text-text-muted">{t('knowledge.noHits')}</li>}
              </ul>
            ) : !docs.data ? (
              <Loading />
            ) : docs.data.length === 0 ? (
              <Empty title={t('knowledge.empty')} hint={t('knowledge.emptyHint')} />
            ) : (
              <ul className="divide-y divide-border/40">
                {docs.data.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/knowledge/${d.id}`)}
                      className={cn('w-full px-3 py-2 text-left hover:bg-bg-hover', id === d.id && 'bg-bg-hover')}
                    >
                      <div className="flex items-center gap-2 text-xs">
                        <span className="truncate font-medium">{d.title}</span>
                        <Badge className="ml-auto">{t(`knowledge.kind.${d.kind}`)}</Badge>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-2xs text-text-muted">
                        <span className="truncate font-mono">{d.path}</span>
                        <span className="ml-auto">{dateTime(d.updated_at, i18n.language)}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
        <section className="min-h-0 overflow-auto p-6">
          {id ? (
            <DocView key={id} id={id} onDelete={() => void m.remove.mutateAsync(id).then(() => navigate('/knowledge'))} />
          ) : (
            <Empty title={t('knowledge.pickDoc')} />
          )}
        </section>
      </div>
      <DocDialog open={newOpen} onOpenChange={setNewOpen} onSaved={(docId) => navigate(`/knowledge/${docId}`)} />
    </Page>
  )
}

function DocView({ id, onDelete }: { id: string; onDelete: () => void }) {
  const { t, i18n } = useTranslation()
  const doc = useDoc(id)
  const m = useDocMutations()
  const [editing, setEditing] = useState(false)
  if (!doc.data) return <Loading />
  const d = doc.data
  return (
    <Section
      title={d.title}
      description={`${d.path} · ${t(`knowledge.kind.${d.kind}`)} · ${dateTime(d.updated_at, i18n.language)}`}
      actions={
        <>
          <div className="flex items-center gap-1.5 text-xs text-text-secondary">
            <Switch
              checked={d.published}
              onChange={(v) => void m.write.mutateAsync({ title: d.title, body: d.body, kind: d.kind, path: d.path, published: v })}
              label={t('knowledge.published')}
            />
            {t('knowledge.published')}
          </div>
          <button type="button" className="btn-outline h-8" onClick={() => setEditing(true)}>
            {t('common.edit')}
          </button>
          <button type="button" className="btn-ghost h-8 text-status-error" onClick={onDelete}>
            {t('common.delete')}
          </button>
        </>
      }
    >
      {d.ai_maintained && <Badge tone="ai" className="mb-3">{t('knowledge.aiMaintained')}</Badge>}
      <Markdown text={d.body} />
      <DocDialog open={editing} onOpenChange={setEditing} doc={d} />
    </Section>
  )
}

function DocDialog({ open, onOpenChange, doc, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; doc?: Doc; onSaved?: (id: string) => void }) {
  const { t } = useTranslation()
  const m = useDocMutations()
  const [form, setForm] = useState({ title: doc?.title ?? '', body: doc?.body ?? '', kind: doc?.kind ?? ('doc' as DocKind), path: doc?.path ?? '' })
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const out = await m.write.mutateAsync({ ...form, path: form.path || undefined })
      onOpenChange(false)
      const docId = (out.result as { doc_id?: string } | null)?.doc_id
      if (docId && onSaved) onSaved(docId)
      if (!doc) setForm({ title: '', body: '', kind: 'doc', path: '' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={doc ? t('common.edit') : t('knowledge.newDoc')} description={t('knowledge.newDocHint')} wide>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <Field label={t('knowledge.title')}>
            <input className="field" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required autoFocus />
          </Field>
          <Field label={t('knowledge.kindLabel')}>
            <select className="field" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as DocKind })} disabled={Boolean(doc)}>
              {KINDS.filter(Boolean).map((k) => (
                <option key={k} value={k}>
                  {t(`knowledge.kind.${k}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={t('knowledge.path')} hint={t('knowledge.pathHint')}>
          <input className="field font-mono" value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} disabled={Boolean(doc)} />
        </Field>
        <Field label={t('knowledge.body')}>
          <textarea className="field min-h-[260px] font-mono text-xs" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn-primary" disabled={m.write.isPending}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
