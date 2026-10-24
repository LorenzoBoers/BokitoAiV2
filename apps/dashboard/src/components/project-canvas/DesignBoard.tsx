import { useEffect, useRef, useState, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import MoveableImpl from 'react-moveable'
import { GripVertical } from 'lucide-react'
import { askCanvasChange, notifyCanvasUpdated, putDesignSource, type ProjectCanvas } from '../../lib/project-canvas-api'
import { Button } from '../ui/button'
import { Callout } from '../ui/callout'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'

type MoveableDrag = { target: HTMLElement; left: number; top: number }
type MoveableResize = MoveableDrag & { width: number; height: number; drag: { left: number; top: number } }

/** Published types target an older JSX runtime. The component itself runs on React 19. */
const Moveable = MoveableImpl as unknown as ComponentType<{
  target: HTMLElement | null
  rootContainer?: HTMLElement | null
  draggable?: boolean
  resizable?: boolean
  origin?: boolean
  dragTarget?: HTMLElement | null
  onDrag?: (event: MoveableDrag) => void
  onDragEnd?: (event: { lastEvent?: { left: number; top: number } }) => void
  onResize?: (event: MoveableResize) => void
  onResizeEnd?: (event: { lastEvent?: { width: number; height: number; drag?: { left: number; top: number } } }) => void
}>

export type DesignFrame = {
  id: string
  x: number
  y: number
  w: number
  h: number
  title: string
  text: string
}

function numberOr(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : fallback
}

/** Frames stored on a design canvas. Invalid source is an empty board. */
export function designFrames(source: string): DesignFrame[] {
  try {
    const data = JSON.parse(source || '{}') as { frames?: unknown } | unknown[]
    const frames = Array.isArray(data) ? data : data?.frames
    if (!Array.isArray(frames)) return []
    return frames.flatMap((frame, index) => {
      if (!frame || typeof frame !== 'object') return []
      const row = frame as Record<string, unknown>
      const id = String(row.id || `f${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || `f${index + 1}`
      return [
        {
          id,
          x: numberOr(row.x, 32),
          y: numberOr(row.y, 32),
          w: numberOr(row.w, 320),
          h: numberOr(row.h, 220),
          title: String(row.title || ''),
          text: String(row.text || ''),
        },
      ]
    })
  } catch {
    return []
  }
}

type Props = {
  canvas: ProjectCanvas
  /** Drag, resize and typing. The chat card stays a preview. */
  editable?: boolean
}

/** Artboards on the host page. Moveable never runs inside the chat card. */
export function DesignBoard({ canvas, editable = false }: Props) {
  const { t } = useTranslation('nav')
  const [frames, setFrames] = useState<DesignFrame[]>(() => designFrames(canvas.source))
  const [selected, setSelected] = useState<string | null>(null)
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [error, setError] = useState('')
  const boardRef = useRef<HTMLDivElement | null>(null)
  const dirty = useRef(false)
  const revision = useRef(canvas.revision)
  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    if (dirty.current) return
    revision.current = canvas.revision
    setFrames(designFrames(canvas.source))
  }, [canvas.id, canvas.revision, canvas.source])

  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    },
    [],
  )

  async function persist(next: DesignFrame[]) {
    dirty.current = true
    setError('')
    try {
      const saved = await putDesignSource(canvas.id, JSON.stringify({ frames: next }), revision.current)
      revision.current = saved.revision
      dirty.current = false
      notifyCanvasUpdated(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('projects.canvas.saveFailed'))
    }
  }

  function schedule(next: DesignFrame[]) {
    dirty.current = true
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void persist(next), 400)
  }

  function update(id: string, patch: Partial<DesignFrame>, immediate = false) {
    const next = frames.map((frame) => (frame.id === id ? { ...frame, ...patch } : frame))
    setFrames(next)
    if (immediate) void persist(next)
    else schedule(next)
  }

  function addFrame() {
    if (frames.length >= 24) return
    const frame: DesignFrame = {
      id: `f${Date.now().toString(36)}`,
      x: 48 + frames.length * 16,
      y: 48 + frames.length * 16,
      w: 320,
      h: 220,
      title: '',
      text: '',
    }
    const next = [...frames, frame]
    setFrames(next)
    setSelected(frame.id)
    void persist(next)
  }

  const width = Math.max(640, ...frames.map((frame) => frame.x + frame.w + 48))
  const height = Math.max(480, ...frames.map((frame) => frame.y + frame.h + 48))

  return (
    <div className="flex min-h-[28rem] flex-col gap-3">
      {error ? <Callout tone="error">{error}</Callout> : null}
      <div
        ref={boardRef}
        className="bk-design relative overflow-auto rounded-xl border border-border bg-bg-base"
        style={{
          minHeight: '28rem',
          backgroundImage: 'radial-gradient(rgb(var(--color-border)) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      >
        <div className="relative" style={{ width, height }}>
          {frames.map((frame) => (
            <div
              key={frame.id}
              data-frame={frame.id}
              className="absolute flex flex-col overflow-hidden rounded-xl border border-border bg-bg-surface"
              style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}
              onPointerDown={(event) => {
                if (!editable) return
                setSelected(frame.id)
                setTarget(event.currentTarget)
              }}
            >
              <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
                {editable ? (
                  <span className="bk-frame-handle cursor-grab text-text-muted" aria-hidden>
                    <GripVertical size={14} />
                  </span>
                ) : null}
                {editable ? (
                  <Input
                    value={frame.title}
                    aria-label={t('projects.canvas.frameTitle')}
                    placeholder={t('projects.canvas.frameTitle')}
                    className="h-7 border-0 bg-transparent px-1 shadow-none focus:ring-0"
                    onPointerDown={(event) => event.stopPropagation()}
                    onChange={(event) => update(frame.id, { title: event.target.value })}
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-heading">
                    {frame.title}
                  </span>
                )}
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() =>
                    askCanvasChange(
                      t('projects.canvas.askFrame', {
                        frame: frame.title || t('projects.canvas.frame'),
                        title: canvas.title,
                      }),
                    )
                  }
                >
                  {t('projects.canvas.askShort')}
                </Button>
              </div>
              {editable ? (
                <Textarea
                  value={frame.text}
                  aria-label={t('projects.canvas.frameText')}
                  placeholder={t('projects.canvas.frameText')}
                  className="min-h-0 flex-1 resize-none rounded-none border-0 bg-transparent focus:ring-0"
                  onPointerDown={(event) => event.stopPropagation()}
                  onChange={(event) => update(frame.id, { text: event.target.value })}
                />
              ) : (
                <p className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 text-sm text-text-primary">
                  {frame.text}
                </p>
              )}
            </div>
          ))}
          {editable && selected && target ? (
            <Moveable
              target={target}
              rootContainer={boardRef.current}
              draggable
              resizable
              origin={false}
              dragTarget={target.querySelector('.bk-frame-handle') as HTMLElement | null}
              onDrag={({ target: node, left, top }) => {
                node.style.left = `${left}px`
                node.style.top = `${top}px`
              }}
              onDragEnd={({ lastEvent }) => {
                const last = lastEvent as { left?: number; top?: number } | undefined
                if (!last || last.left == null || last.top == null) return
                update(selected, { x: Math.round(last.left), y: Math.round(last.top) }, true)
              }}
              onResize={({ target: node, width: nextWidth, height: nextHeight, drag }) => {
                node.style.width = `${nextWidth}px`
                node.style.height = `${nextHeight}px`
                node.style.left = `${drag.left}px`
                node.style.top = `${drag.top}px`
              }}
              onResizeEnd={({ lastEvent }) => {
                const last = lastEvent as
                  | { width?: number; height?: number; drag?: { left?: number; top?: number } }
                  | undefined
                if (!last?.width || !last.height) return
                update(
                  selected,
                  {
                    w: Math.round(last.width),
                    h: Math.round(last.height),
                    x: Math.round(last.drag?.left ?? 0),
                    y: Math.round(last.drag?.top ?? 0),
                  },
                  true,
                )
              }}
            />
          ) : null}
        </div>
      </div>
      {editable ? (
        <div>
          <Button type="button" size="sm" variant="secondary" disabled={frames.length >= 24} onClick={addFrame}>
            {t('projects.canvas.addFrame')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
