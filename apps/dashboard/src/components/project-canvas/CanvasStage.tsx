import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import { deleteCanvas, getCanvasById, notifyCanvasRemoved, type ProjectCanvas } from '../../lib/project-canvas-api'
import { renderCanvasTree } from '../../lib/project-canvas/render'
import { canvasIsPending, canvasKindOf, isEmptyCanvasTree } from '../../lib/project-canvas/types'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Callout } from '../ui/callout'
import { useConfirm } from '../ui/confirm-dialog'
import { DropdownMenuItem } from '../ui/dropdown-menu'
import { Skeleton } from '../ui/skeleton'
import { CanvasKindBody } from './CanvasKindBody'
import { CanvasWindow } from './CanvasWindow'

/** The canvas beside its conversation. Fills the pane it is placed in. */
export function CanvasStage({ canvasId, onClose }: { canvasId: string; onClose: () => void }) {
  const { t } = useTranslation('nav')
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
      bodyClassName="flex-1"
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
      {canvas && !pending && !tree && kind !== 'dashboard' ? <CanvasKindBody canvas={canvas} /> : null}
    </CanvasWindow>
  )
}
