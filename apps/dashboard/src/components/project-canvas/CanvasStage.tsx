import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import { formatAppDateTime } from '../../lib/app-locale'
import {
  askCanvasChange,
  CANVAS_UPDATED_EVENT,
  deleteCanvas,
  getCanvasById,
  notifyCanvasRemoved,
  type ProjectCanvas,
} from '../../lib/project-canvas-api'
import { TextLink } from '../ui/text-link'
import { renderCanvasTree } from '../../lib/project-canvas/render'
import { canvasIsPending, canvasKindOf, isEmptyCanvasTree } from '../../lib/project-canvas/types'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Callout } from '../ui/callout'
import { useConfirm } from '../ui/confirm-dialog'
import { DropdownMenuItem } from '../ui/dropdown-menu'
import { Skeleton } from '../ui/skeleton'
import { CanvasKindBody } from './CanvasKindBody'
import { CanvasWindow } from './CanvasWindow'

function canvasCaption(
  canvas: ProjectCanvas,
  t: (key: string, options?: Record<string, string>) => string,
  language: string,
): ReactNode {
  const bits: ReactNode[] = []
  if (canvas.managing_agent?.name) bits.push(<span key="agent">{canvas.managing_agent.name}</span>)
  if (canvas.updated_at) {
    bits.push(
      <span key="updated">
        {t('projects.canvas.lastUpdated', {
          time: formatAppDateTime(new Date(canvas.updated_at), language),
        })}
      </span>,
    )
  }
  bits.push(
    canvas.folder_id ? (
      <TextLink
        key="folder"
        to={`/folders/${canvas.folder_id}?canvas=${canvas.id}`}
        tone="muted"
        className="font-normal"
      >
        {canvas.folder_name || t('projects.canvas.openFolder')}
      </TextLink>
    ) : (
      <span key="folder">{t('projects.canvas.unfiled')}</span>
    ),
  )
  return bits.flatMap((bit, index) => (index === 0 ? [bit] : [<span key={`dot-${index}`}> · </span>, bit]))
}

/** The canvas beside its conversation. Fills the pane it is placed in. */
export function CanvasStage({ canvasId, onClose }: { canvasId: string; onClose: () => void }) {
  const { t, i18n } = useTranslation('nav')
  const confirm = useConfirm()
  const isAdmin = useIsAdmin()
  const [canvas, setCanvas] = useState<ProjectCanvas | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    let cancel = false
    setCanvas(null)
    setFailed(false)
    setActionError('')
    getCanvasById(canvasId)
      .then((row) => {
        if (!cancel) setCanvas(row)
      })
      .catch(() => {
        if (!cancel) setFailed(true)
      })
    return () => {
      cancel = true
    }
  }, [canvasId])

  useEffect(() => {
    function onUpdated(event: Event) {
      const next = (event as CustomEvent<ProjectCanvas>).detail
      if (!next || next.id !== canvasId) return
      setCanvas((current) => (current && current.revision > next.revision ? current : next))
    }
    window.addEventListener(CANVAS_UPDATED_EVENT, onUpdated)
    return () => window.removeEventListener(CANVAS_UPDATED_EVENT, onUpdated)
  }, [canvasId])

  // The chat card reloads on its own. This pane stays mounted, so it asks again
  // while it is open and the agent may still be writing.
  useEffect(() => {
    let cancel = false
    const tick = () => {
      if (document.hidden) return
      getCanvasById(canvasId)
        .then((row) => {
          if (cancel) return
          setCanvas((current) => {
            if (current && current.revision === row.revision && current.updated_at === row.updated_at) return current
            return row
          })
        })
        .catch(() => undefined)
    }
    const id = window.setInterval(tick, 3000)
    return () => {
      cancel = true
      window.clearInterval(id)
    }
  }, [canvasId])

  async function onDelete() {
    if (!canvas || busy) return
    if (!(await confirm({ description: t('projects.canvas.deleteConfirm'), destructive: true }))) return
    setBusy(true)
    setActionError('')
    try {
      await deleteCanvas(canvas.id)
      notifyCanvasRemoved(canvas.id)
      onClose()
    } catch (err) {
      setActionError(formatApiErrorMessage(err, t('projects.canvas.deleteError')))
    } finally {
      setBusy(false)
    }
  }

  const caption = canvas ? canvasCaption(canvas, t, i18n.language) : null

  function askAboutThis() {
    if (!canvas) return
    askCanvasChange(t('projects.canvas.askDraft', { title: canvas.title }))
  }

  const kind = canvasKindOf(canvas?.kind)
  const pending = canvas ? canvasIsPending(canvas) : false
  // Empty shells only mean "writing" while the agent turn is still live.
  // A stuck empty canvas after the turn is incomplete, not forever writing.
  const tree = canvas && kind === 'dashboard' && !pending && !isEmptyCanvasTree(canvas.tree) ? canvas.tree : null

  return (
    <CanvasWindow
      canvas={pending ? null : canvas}
      title={canvas?.title || t('projects.canvas.loading')}
      kind={kind}
      allowSource={Boolean(canvas)}
      caption={caption}
      onAsk={canvas && !pending ? askAboutThis : undefined}
      onMinimize={onClose}
      onClose={onClose}
      menu={
        isAdmin && canvas ? (
          <DropdownMenuItem
            className="gap-2 text-status-error"
            disabled={busy}
            onClick={() => void onDelete()}
          >
            <Trash2 size={14} aria-hidden />
            {t('projects.canvas.delete')}
          </DropdownMenuItem>
        ) : undefined
      }
      muted={pending}
      status={
        pending
          ? t('projects.canvas.incomplete')
          : failed
            ? t('projects.canvas.loadError')
            : undefined
      }
      className="h-full rounded-none border-0"
      bodyClassName="flex min-h-0 flex-1 flex-col"
      data-testid="canvas-stage"
    >
      {actionError ? (
        <Callout tone="error" className="mb-3">
          {actionError}
        </Callout>
      ) : null}
      {!canvas && !failed ? <Skeleton className="h-40" /> : null}
      {failed ? <p className="text-sm text-text-muted">{t('projects.canvas.loadError')}</p> : null}
      {canvas && pending ? (
        <p className="py-8 text-center text-sm text-text-secondary">{t('projects.canvas.incomplete')}</p>
      ) : null}
      {tree ? <div className="min-h-[12rem]">{renderCanvasTree(tree)}</div> : null}
      {canvas && !pending && !tree && kind !== 'dashboard' ? (
        <CanvasKindBody canvas={canvas} editable />
      ) : null}
    </CanvasWindow>
  )
}
