import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Code2, MessageSquare, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { ApiErrorBanner, formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { ProjectCanvasSkeleton } from '../ui/skeleton'
import {
  createCanvas,
  deleteCanvas,
  listCanvases,
  patchCanvasMeta,
  type ProjectCanvas,
  type RefreshCadence,
} from '../../lib/project-canvas-api'
import { renderCanvasTree } from '../../lib/project-canvas/render'
import { isEmptyCanvasTree } from '../../lib/project-canvas/types'
import { agentChatPath, newConversationPath } from '../../lib/messages-paths'
import { formatAppDateTime } from '../../lib/app-locale'

const REFRESH_CADENCES: RefreshCadence[] = ['manual', 'daily', 'weekly', 'hourly', 'monthly']

type Props = {
  ownerKind: 'project' | 'tenant'
  ownerId: string
  fallbackAgentId?: string | null
  canEdit?: boolean
}

export function CanvasHost({ ownerKind, ownerId, fallbackAgentId, canEdit = false }: Props) {
  const { t, i18n } = useTranslation('nav')
  const [items, setItems] = useState<ProjectCanvas[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showSource, setShowSource] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newBrief, setNewBrief] = useState('')
  const [newCadence, setNewCadence] = useState<RefreshCadence>('daily')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await listCanvases(ownerKind, ownerId)
      setItems(rows)
      setActiveId((current) => {
        if (current && rows.some((row) => row.id === current)) return current
        return rows[0]?.id ?? null
      })
    } catch (err) {
      setError(formatApiErrorMessage(err, t('projects.canvas.loadError')))
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [ownerKind, ownerId, t])

  useEffect(() => {
    void load()
  }, [load])

  const canvas = items.find((row) => row.id === activeId) ?? null
  const agentId = canvas?.managing_agent_id || fallbackAgentId
  const askHref = agentId ? agentChatPath(agentId) : newConversationPath()

  function openAdd() {
    setNewTitle('')
    setNewBrief('')
    setNewCadence('daily')
    setAdding(true)
  }

  async function onAdd() {
    const title = newTitle.trim()
    const notes = newBrief.trim()
    if (!title || !notes) return
    setBusy(true)
    try {
      const created = await createCanvas({
        owner_kind: ownerKind,
        owner_id: ownerId,
        title,
        notes,
        refresh_cadence: newCadence,
      })
      setAdding(false)
      setItems((rows) => [...rows, created])
      setActiveId(created.id)
    } catch (err) {
      setError(formatApiErrorMessage(err, t('projects.canvas.addError')))
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm(t('projects.canvas.deleteConfirm'))) return
    setBusy(true)
    try {
      await deleteCanvas(id)
      const next = items.filter((row) => row.id !== id)
      setItems(next)
      setActiveId(next[0]?.id ?? null)
    } catch (err) {
      setError(formatApiErrorMessage(err, t('projects.canvas.deleteError')))
    } finally {
      setBusy(false)
    }
  }

  async function onCadenceChange(id: string, cadence: RefreshCadence) {
    setBusy(true)
    try {
      const updated = await patchCanvasMeta(id, { refresh_cadence: cadence })
      setItems((rows) => rows.map((row) => (row.id === id ? updated : row)))
    } catch (err) {
      setError(formatApiErrorMessage(err, t('projects.canvas.saveError')))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <ProjectCanvasSkeleton />
  if (error && items.length === 0) return <ApiErrorBanner message={error} onRetry={() => void load()} />

  return (
    <div className="space-y-4">
      {error ? <ApiErrorBanner message={error} onRetry={() => void load()} /> : null}

      <Tabs
        value={canvas?.id ?? 'empty'}
        onValueChange={(value) => {
          if (value !== 'empty') setActiveId(value)
        }}
      >
        <TabsList className="h-auto min-h-9 w-full flex-wrap justify-start overflow-visible">
          {items.map((row) => (
            <TabsTrigger key={row.id} value={row.id}>
              {row.title}
            </TabsTrigger>
          ))}
          {canEdit ? (
            <button
              type="button"
              className="-mb-px inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2.5 text-sm font-medium text-text-secondary hover:text-text-primary"
              onClick={openAdd}
              disabled={busy}
            >
              <Plus size={14} />
              {t('projects.canvas.add')}
            </button>
          ) : null}
        </TabsList>

        {items.length === 0 ? (
          <TabsContent value="empty" />
        ) : null}

        {items.map((row) => (
          <TabsContent key={row.id} value={row.id}>
            {row.id === canvas?.id ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    {row.updated_at ? (
                      <p className="text-xs text-text-muted">
                        {t('projects.canvas.lastUpdated', {
                          time: formatAppDateTime(new Date(row.updated_at), i18n.language),
                          who: row.updated_by_type ? ` · ${row.updated_by_type}` : '',
                        })}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {canEdit ? (
                      <Select
                        value={row.refresh_cadence || 'manual'}
                        disabled={busy}
                        onValueChange={(value) => void onCadenceChange(row.id, value as RefreshCadence)}
                      >
                        <SelectTrigger className="h-8 w-auto min-w-[8rem] text-xs" aria-label={t('projects.canvas.refreshLabel')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {REFRESH_CADENCES.map((cadence) => (
                            <SelectItem key={cadence} value={cadence}>
                              {t(`projects.canvas.cadence.${cadence}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                    <Button type="button" size="sm" variant="outline" asChild>
                      <Link to={askHref}>
                        <MessageSquare size={14} className="mr-1.5" />
                        {t('projects.canvas.askAgent')}
                      </Link>
                    </Button>
                    {canEdit ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => setShowSource((v) => !v)}>
                        <Code2 size={14} className="mr-1.5" />
                        {showSource ? t('projects.canvas.hideSource') : t('projects.canvas.showSource')}
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" variant="ghost" onClick={() => void load()}>
                      <RotateCcw size={14} className="mr-1.5" />
                      {t('projects.detail.refresh')}
                    </Button>
                    {canEdit ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => void onDelete(row.id)} disabled={busy}>
                        <Trash2 size={14} className="mr-1.5" />
                        {t('projects.canvas.delete')}
                      </Button>
                    ) : null}
                  </div>
                </div>

                {row.empty || isEmptyCanvasTree(row.tree) ? (
                  <div className="rounded-lg border border-border/60 bg-bg-input/30 px-4 py-8 text-center">
                    <p className="text-sm text-text-secondary">{t('projects.canvas.writing')}</p>
                  </div>
                ) : (
                  <div className="min-h-[12rem]">{renderCanvasTree(row.tree)}</div>
                )}

                {showSource && canEdit ? (
                  <pre className="overflow-auto rounded-lg border border-border/60 bg-bg-input/40 p-3 text-xs text-text-secondary">
                    {row.source}
                  </pre>
                ) : null}
              </div>
            ) : null}
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('projects.canvas.add')}</DialogTitle>
            <DialogDescription>{t('projects.canvas.addDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="canvas-title">{t('projects.canvas.titleLabel')}</Label>
              <Input
                id="canvas-title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={t('projects.canvas.titlePlaceholder')}
              />
            </div>
            <div>
              <Label htmlFor="canvas-brief">{t('projects.canvas.briefLabel')}</Label>
              <Textarea
                id="canvas-brief"
                value={newBrief}
                onChange={(e) => setNewBrief(e.target.value)}
                placeholder={t('projects.canvas.briefPlaceholder')}
                rows={4}
              />
            </div>
            <div>
              <Label htmlFor="canvas-refresh">{t('projects.canvas.refreshLabel')}</Label>
              <Select value={newCadence} onValueChange={(value) => setNewCadence(value as RefreshCadence)}>
                <SelectTrigger id="canvas-refresh" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REFRESH_CADENCES.map((cadence) => (
                    <SelectItem key={cadence} value={cadence}>
                      {t(`projects.canvas.cadence.${cadence}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)} disabled={busy}>
              {t('projects.canvas.cancel')}
            </Button>
            <Button type="button" onClick={() => void onAdd()} disabled={busy || !newTitle.trim() || !newBrief.trim()}>
              {t('projects.canvas.add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
