import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { CANVAS_ICON, ENTITY_ICONS } from '../../lib/entity-icons'
import { AgentMark } from '../ui/AgentMark'
import { Button } from '../ui/button'
import { useConfirm } from '../ui/confirm-dialog'
import { DropdownMenuItem } from '../ui/dropdown-menu'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
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
import { AgentSelect } from '../ui/AgentSelect'
import {
  deleteCanvas,
  listCanvases,
  notifyCanvasRemoved,
  patchCanvasMeta,
  type ProjectCanvas,
  type RefreshCadence,
} from '../../lib/project-canvas-api'
import { CanvasKindBody } from './CanvasKindBody'
import { CanvasWindow } from './CanvasWindow'
import { renderCanvasTree } from '../../lib/project-canvas/render'
import { canvasIsPending, canvasKindOf } from '../../lib/project-canvas/types'
import { agentChatPath, inboxPath } from '../../lib/messages-paths'
import { formatAppDateTime } from '../../lib/app-locale'
import { listAgents } from '../../lib/agents-api'
import { bokitoCreateConversation } from '../../lib/signals-api'
import { stashChatContinue } from '../../lib/chat-auto-continue'
import { useAuth } from '../../context/AuthContext'
import type { RuntimeAgent } from '../../lib/workforce-api'

const REFRESH_CADENCES: RefreshCadence[] = ['manual', 'daily', 'weekly', 'hourly', 'monthly', 'custom']

function cronLooksValid(value: string): boolean {
  return value.trim().split(/\s+/).length === 5
}

type Props = {
  /** The folder the canvases live in. */
  ownerId: string
  /** Shown in the setup chat opener (folder name). */
  ownerLabel?: string | null
  fallbackAgentId?: string | null
  canEdit?: boolean
}

export function CanvasHost({
  ownerId,
  ownerLabel,
  fallbackAgentId,
  canEdit = false,
}: Props) {
  const { t, i18n } = useTranslation('nav')
  const { token } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const requestedCanvasId = searchParams.get('canvas')
  const confirm = useConfirm()
  const [items, setItems] = useState<ProjectCanvas[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [agents, setAgents] = useState<RuntimeAgent[]>([])
  const [pickedAgentId, setPickedAgentId] = useState('')
  const [agentsLoading, setAgentsLoading] = useState(false)
  const [cronDraft, setCronDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await listCanvases(ownerId)
      setItems(rows)
      setActiveId((current) => {
        if (requestedCanvasId && rows.some((row) => row.id === requestedCanvasId)) return requestedCanvasId
        if (current && rows.some((row) => row.id === current)) return current
        return rows[0]?.id ?? null
      })
    } catch (err) {
      setError(formatApiErrorMessage(err, t('projects.canvas.loadError')))
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [ownerId, requestedCanvasId, t])

  useEffect(() => {
    void load()
  }, [load])

  const canvas = items.find((row) => row.id === activeId) ?? null
  const agentId = canvas?.managing_agent_id || fallbackAgentId

  const leadAgentId = useMemo(
    () => agents.find((row) => row.is_lead)?.id ?? agents[0]?.id ?? '',
    [agents],
  )

  function threadHref(row: ProjectCanvas): string {
    if (row.thread?.path) return row.thread.path
    if (row.signal_id && (row.managing_agent_id || agentId)) {
      return agentChatPath(row.managing_agent_id || agentId || '', row.signal_id)
    }
    if (row.signal_id) return inboxPath('open', row.signal_id)
    return agentId ? agentChatPath(agentId) : inboxPath()
  }

  async function openAdd() {
    setAdding(true)
    setAgentsLoading(true)
    setError(null)
    try {
      const rows = await listAgents()
      setAgents(rows)
      const preferred =
        (fallbackAgentId && rows.some((row) => row.id === fallbackAgentId) && fallbackAgentId) ||
        rows.find((row) => row.is_lead)?.id ||
        rows[0]?.id ||
        ''
      setPickedAgentId(preferred)
    } catch (err) {
      setError(formatApiErrorMessage(err, t('projects.canvas.addError')))
      setAgents([])
      setPickedAgentId('')
    } finally {
      setAgentsLoading(false)
    }
  }

  function shownCadence(row: ProjectCanvas): RefreshCadence {
    if (row.id in cronDraft) return 'custom'
    return row.refresh_cadence || 'manual'
  }

  function setupOpener(): string {
    const place = ownerLabel?.trim() || t('projects.canvas.ownerFolderFallback')
    return t('projects.canvas.setupOpener', { place })
  }

  async function onStartSetup() {
    const agent = pickedAgentId || leadAgentId
    if (!token || !agent || busy) return
    setBusy(true)
    setError(null)
    try {
      const content = setupOpener()
      const title = t('projects.canvas.setupThreadTitle', {
        place: ownerLabel?.trim() || t('projects.canvas.ownerFolderFallback'),
      })
      const created = await bokitoCreateConversation(token, title, agent, {
        message: content,
        folderId: ownerId,
      })
      const path = agentChatPath(agent, created.id)
      setAdding(false)
      if (created.has_opener) {
        stashChatContinue(created.id, { mode: 'continue' })
        navigate(path, { state: { continuePending: true } })
      } else {
        stashChatContinue(created.id, { mode: 'send', text: content })
        navigate(path, { state: { autoSend: content } })
      }
    } catch (err) {
      setError(formatApiErrorMessage(err, t('projects.canvas.addError')))
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(id: string) {
    if (!(await confirm({ description: t('projects.canvas.deleteConfirm'), destructive: true }))) return
    setBusy(true)
    try {
      await deleteCanvas(id)
      notifyCanvasRemoved(id)
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
    if (cadence === 'custom') {
      const row = items.find((item) => item.id === id)
      setCronDraft((prev) => ({ ...prev, [id]: prev[id] ?? row?.refresh_cron ?? '0 8 * * 1-5' }))
      return
    }
    setCronDraft((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
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

  async function onCronCommit(id: string) {
    const row = items.find((item) => item.id === id)
    const value = (cronDraft[id] ?? row?.refresh_cron ?? '').trim()
    if (!cronLooksValid(value)) {
      setError(t('projects.canvas.cronInvalid'))
      return
    }
    if (row?.refresh_cadence === 'custom' && (row.refresh_cron || '').trim() === value) return
    setBusy(true)
    try {
      const updated = await patchCanvasMeta(id, { refresh_cadence: 'custom', refresh_cron: value })
      setItems((rows) => rows.map((item) => (item.id === id ? updated : item)))
      setCronDraft((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
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
        {items.length > 0 ? (
          <TabsList className="h-auto min-h-9 w-full flex-wrap justify-start overflow-visible">
            {items.map((row) => {
              const pending = canvasIsPending(row)
              return (
                <TabsTrigger
                  key={row.id}
                  value={row.id}
                  className={pending ? 'opacity-50' : undefined}
                  title={pending ? t('projects.canvas.writing') : undefined}
                  data-canvas-pending={pending ? 'true' : undefined}
                >
                  <CANVAS_ICON size={14} className="shrink-0 opacity-80" aria-hidden />
                  <span className="truncate">{row.title}</span>
                  {pending ? (
                    <span className="ml-1 truncate text-2xs font-normal text-text-muted">
                      {t('projects.canvas.buildingBadge')}
                    </span>
                  ) : null}
                </TabsTrigger>
              )
            })}
            {canEdit ? (
              <button
                type="button"
                className="-mb-px inline-flex h-9 w-9 shrink-0 items-center justify-center border-b-2 border-transparent text-text-secondary hover:text-text-primary disabled:opacity-40"
                onClick={() => void openAdd()}
                disabled={busy}
                title={t('projects.canvas.add')}
                aria-label={t('projects.canvas.add')}
              >
                <Plus size={16} aria-hidden />
              </button>
            ) : null}
          </TabsList>
        ) : null}

        {items.length === 0 ? (
          <TabsContent value="empty">
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <CANVAS_ICON size={28} className="text-text-muted opacity-70" aria-hidden />
              <p className="text-sm text-text-muted">{t('projects.canvas.emptyHint')}</p>
              {canEdit ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => void openAdd()} disabled={busy}>
                  <Plus size={14} className="mr-1.5 shrink-0" aria-hidden />
                  {t('projects.canvas.add')}
                </Button>
              ) : null}
            </div>
          </TabsContent>
        ) : null}

        {items.map((row) => (
          <TabsContent key={row.id} value={row.id}>
            {row.id === canvas?.id ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {row.managing_agent ? (
                      <Link
                        to={row.managing_agent.path}
                        className="inline-flex min-w-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        title={t('projects.canvas.ownerAgent')}
                      >
                        <AgentMark agent={row.managing_agent} size={32} mode="static" />
                        <span className="truncate text-sm font-medium text-text-primary">
                          {row.managing_agent.name}
                        </span>
                      </Link>
                    ) : null}
                    {row.updated_at ? (
                      <p className="min-w-0 truncate text-xs text-text-muted">
                        {t('projects.canvas.lastUpdated', {
                          time: formatAppDateTime(new Date(row.updated_at), i18n.language),
                        })}
                      </p>
                    ) : null}
                    {canEdit && canvasKindOf(row.kind) === 'dashboard' ? (
                      <Select
                        value={shownCadence(row)}
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
                    {canEdit && canvasKindOf(row.kind) === 'dashboard' && shownCadence(row) === 'custom' ? (
                      <Input
                        value={cronDraft[row.id] ?? row.refresh_cron ?? ''}
                        onChange={(e) => setCronDraft((prev) => ({ ...prev, [row.id]: e.target.value }))}
                        onBlur={() => void onCronCommit(row.id)}
                        placeholder={t('projects.canvas.cronPlaceholder')}
                        aria-label={t('projects.canvas.cronLabel')}
                        className="h-8 w-36 font-mono text-xs"
                        disabled={busy}
                      />
                    ) : null}
                  </div>
                  <Button type="button" size="sm" variant="secondary" asChild>
                    <Link to={threadHref(row)}>
                      <ENTITY_ICONS.conversation size={14} className="mr-1.5 shrink-0" aria-hidden />
                      {row.thread?.title || t('projects.canvas.openThread')}
                    </Link>
                  </Button>
                </div>

                <CanvasWindow
                  canvas={canvasIsPending(row) ? null : row}
                  title={row.title}
                  kind={canvasKindOf(row.kind)}
                  allowSource={canEdit}
                  muted={canvasIsPending(row)}
                  status={canvasIsPending(row) ? t('projects.canvas.writing') : undefined}
                  onRefresh={() => void load()}
                  menu={
                    canEdit ? (
                      <DropdownMenuItem
                        className="gap-2 text-status-error"
                        disabled={busy}
                        onClick={() => void onDelete(row.id)}
                      >
                        <Trash2 size={14} />
                        {t('projects.canvas.delete')}
                      </DropdownMenuItem>
                    ) : undefined
                  }
                  bodyClassName="min-h-[24rem]"
                >
                  {canvasIsPending(row) ? (
                    <p className="py-8 text-center text-sm text-text-secondary">{t('projects.canvas.writing')}</p>
                  ) : canvasKindOf(row.kind) === 'dashboard' ? (
                    <div className="min-h-[12rem]">{renderCanvasTree(row.tree)}</div>
                  ) : (
                    <CanvasKindBody canvas={row} />
                  )}
                </CanvasWindow>
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
              <Label htmlFor="canvas-owner-agent">{t('projects.canvas.agentLabel')}</Label>
              <div className="mt-1">
                <AgentSelect
                  agents={agents}
                  value={pickedAgentId}
                  onValueChange={setPickedAgentId}
                  placeholder={
                    agentsLoading
                      ? t('projects.canvas.agentLoading')
                      : t('projects.canvas.agentPlaceholder')
                  }
                  disabled={busy || agentsLoading || agents.length === 0}
                  aria-label={t('projects.canvas.agentLabel')}
                />
              </div>
              <p className="mt-1.5 text-xs text-text-muted">{t('projects.canvas.agentHint')}</p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)} disabled={busy}>
              {t('projects.canvas.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => void onStartSetup()}
              disabled={busy || agentsLoading || !pickedAgentId}
            >
              {t('projects.canvas.startChat')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
