/**
 * Command palette: the chat path for every page action. Type to filter pages,
 * conversations and tools; pick a tool to fill its arguments from the schema
 * and run it through `POST /tools/execute` (same policy as agents and MCP).
 */
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { ArrowRight, Command, MessageSquare, Wrench } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { useConversations, useExecuteTool, useTools } from '@/api/queries'
import type { ToolDef } from '@/api/types'
import { cn } from '@/lib/cn'
import { SURFACES } from '@/shell/surfaces'

type Item =
  | { kind: 'page'; id: string; label: string; to: string }
  | { kind: 'conversation'; id: string; label: string; to: string; hint: string }
  | { kind: 'tool'; id: string; label: string; tool: ToolDef }

export function useCommandPalette() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return { open, setOpen }
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [tool, setTool] = useState<ToolDef | null>(null)
  const tools = useTools()
  const conversations = useConversations({ q: q.length > 1 ? q : undefined, queue: 'all', limit: 5 })
  const conversationId = location.pathname.startsWith('/communication/') ? location.pathname.split('/')[2] : undefined

  useEffect(() => {
    if (!open) {
      setQ('')
      setTool(null)
      setActive(0)
    }
  }, [open])

  const items = useMemo<Item[]>(() => {
    const needle = q.trim().toLowerCase()
    const pages: Item[] = SURFACES.map(
      (s): Item => ({ kind: 'page', id: `page:${s.key}`, label: t(`nav.${s.key}`), to: s.to }),
    ).filter((p) => !needle || p.label.toLowerCase().includes(needle))
    const convs: Item[] = needle.length > 1
      ? (conversations.data?.items ?? []).map((c) => ({
          kind: 'conversation',
          id: `conv:${c.id}`,
          label: c.subject || t('communication.noSubject'),
          to: `/communication/${c.id}`,
          hint: t(`channels.${c.channel}`),
        }))
      : []
    const toolItems: Item[] = (tools.data ?? [])
      .filter((td) => !needle || td.name.includes(needle) || td.description.toLowerCase().includes(needle))
      .slice(0, needle ? 12 : 6)
      .map((td) => ({ kind: 'tool', id: `tool:${td.name}`, label: td.name, tool: td }))
    return [...pages, ...convs, ...toolItems]
  }, [q, t, conversations.data, tools.data])

  useEffect(() => setActive(0), [q])

  function pick(item: Item) {
    if (item.kind === 'tool') {
      setTool(item.tool)
      return
    }
    navigate(item.to)
    onOpenChange(false)
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50 animate-fade-in" />
        <DialogPrimitive.Content className="panel fixed left-1/2 top-[15vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden p-0 shadow-overlay animate-pop-in">
          <DialogPrimitive.Title className="sr-only">{t('nav.search')}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">{t('palette.hint')}</DialogPrimitive.Description>
          {tool ? (
            <ToolForm
              tool={tool}
              conversationId={conversationId}
              onBack={() => setTool(null)}
              onDone={() => onOpenChange(false)}
            />
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-border/60 px-3">
                <Command className="h-4 w-4 text-text-muted" />
                <input
                  autoFocus
                  className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-text-muted"
                  placeholder={t('nav.search')}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setActive((a) => Math.min(items.length - 1, a + 1))
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      setActive((a) => Math.max(0, a - 1))
                    } else if (e.key === 'Enter' && items[active]) {
                      e.preventDefault()
                      pick(items[active])
                    }
                  }}
                />
                <kbd className="chip font-mono">esc</kbd>
              </div>
              <ul className="max-h-[50vh] overflow-auto py-1" role="listbox">
                {items.length === 0 && <li className="px-3 py-6 text-center text-xs text-text-muted">{t('palette.noResults')}</li>}
                {items.map((item, i) => (
                  <li key={item.id} role="option" aria-selected={i === active}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(item)}
                      className={cn('flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm', i === active && 'bg-bg-hover')}
                    >
                      {item.kind === 'page' && <ArrowRight className="h-3.5 w-3.5 text-text-muted" />}
                      {item.kind === 'conversation' && <MessageSquare className="h-3.5 w-3.5 text-text-muted" />}
                      {item.kind === 'tool' && <Wrench className="h-3.5 w-3.5 text-ai-ink" />}
                      <span className={cn('truncate', item.kind === 'tool' && 'font-mono text-xs')}>{item.label}</span>
                      {item.kind === 'conversation' && <span className="ml-auto text-2xs text-text-muted">{item.hint}</span>}
                      {item.kind === 'tool' && (
                        <span className="ml-auto flex items-center gap-1">
                          <span className="chip">{item.tool.category}</span>
                          {item.tool.consequential && <span className="chip text-status-warning">{t('palette.asks')}</span>}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="border-t border-border/60 px-3 py-1.5 text-2xs text-text-muted">{t('palette.hint')}</div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function coerce(type: string | undefined, raw: string): unknown {
  if (raw === '') return undefined
  if (type === 'integer' || type === 'number') return Number(raw)
  if (type === 'boolean') return raw === 'true' || raw === '1' || raw === 'yes'
  if (type === 'array' || type === 'object') {
    try {
      return JSON.parse(raw)
    } catch {
      return type === 'array' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : raw
    }
  }
  return raw
}

function ToolForm({ tool, conversationId, onBack, onDone }: { tool: ToolDef; conversationId?: string; onBack: () => void; onDone: () => void }) {
  const { t } = useTranslation()
  const execute = useExecuteTool()
  const navigate = useNavigate()
  const props = Object.entries(tool.input_schema.properties ?? {})
  const required = new Set(tool.input_schema.required ?? [])
  const [values, setValues] = useState<Record<string, string>>((): Record<string, string> =>
    conversationId && props.some(([k]) => k === 'conversation_id') ? { conversation_id: conversationId } : {},
  )
  const [result, setResult] = useState<unknown>(undefined)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const args: Record<string, unknown> = {}
    for (const [k, schema] of props) {
      const v = coerce(schema.type, values[k] ?? '')
      if (v !== undefined) args[k] = v
    }
    try {
      const out = await execute.mutateAsync({ name: tool.name, args, conversation_id: conversationId })
      if (out.status === 'decision') {
        toast.message(t('palette.decisionRaised'))
        navigate(conversationId ? `/communication/${conversationId}` : '/communication')
        onDone()
      } else if (out.status === 'denied') {
        toast.error(out.reason || t('communication.denied'))
      } else if (tool.category === 'read' && out.result !== undefined && out.result !== null) {
        // Read tools answer a question: keep the palette open and show the result.
        setResult(out.result)
      } else {
        toast.success(t('palette.ran', { name: tool.name }))
        onDone()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    }
  }

  return (
    <form onSubmit={submit} className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <button type="button" className="btn-ghost h-7 px-2 text-xs" onClick={onBack}>
          {t('common.back')}
        </button>
        <span className="font-mono text-sm text-text-heading">{tool.name}</span>
        <span className="chip">{tool.category}</span>
      </div>
      <p className="mb-3 text-xs text-text-muted">{tool.description}</p>
      <div className="max-h-[45vh] space-y-2 overflow-auto">
        {props.map(([k, schema]) => (
          <label key={k} className="block text-xs text-text-secondary">
            <span className="font-mono">
              {k}
              {required.has(k) ? ' *' : ''}
            </span>
            {schema.description && <span className="ml-1 text-text-muted">{schema.description}</span>}
            {schema.type === 'string' && (k === 'body' || k === 'instructions' || k === 'summary') ? (
              <textarea className="field mt-1 min-h-[72px]" value={values[k] ?? ''} onChange={(e) => setValues({ ...values, [k]: e.target.value })} required={required.has(k)} />
            ) : (
              <input
                className="field mt-1"
                value={values[k] ?? ''}
                placeholder={schema.default !== undefined && schema.default !== null ? String(schema.default) : schema.type ?? ''}
                onChange={(e) => setValues({ ...values, [k]: e.target.value })}
                required={required.has(k)}
              />
            )}
          </label>
        ))}
        {props.length === 0 && <p className="text-xs text-text-muted">{t('palette.noArgs')}</p>}
        {result !== undefined && (
          <div>
            <div className="mb-1 text-2xs uppercase tracking-wide text-text-muted">{t('palette.result')}</div>
            <pre className="max-h-48 overflow-auto rounded-lg bg-bg-elevated p-2 text-2xs text-text-secondary">
              {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
      <div className="mt-3 flex justify-end">
        <button type="submit" className="btn-primary" disabled={execute.isPending}>
          {t('palette.run')}
        </button>
      </div>
    </form>
  )
}
