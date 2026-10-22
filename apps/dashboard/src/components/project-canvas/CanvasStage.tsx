import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getCanvasById, type ProjectCanvas } from '../../lib/project-canvas-api'
import { renderCanvasTree } from '../../lib/project-canvas/render'
import { canvasIsPending, canvasKindOf, isEmptyCanvasTree } from '../../lib/project-canvas/types'
import { Skeleton } from '../ui/skeleton'
import { CanvasKindBody } from './CanvasKindBody'
import { CanvasWindow } from './CanvasWindow'

/** The canvas beside its conversation. Fills the pane it is placed in. */
export function CanvasStage({ canvasId, onClose }: { canvasId: string; onClose: () => void }) {
  const { t } = useTranslation('nav')
  const [canvas, setCanvas] = useState<ProjectCanvas | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancel = false
    setCanvas(null)
    setFailed(false)
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
